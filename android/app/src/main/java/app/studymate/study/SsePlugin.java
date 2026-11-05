package app.studymate.study;

import android.os.Handler;
import android.os.Looper;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * 原生 SSE 通道
 *
 * 为什么需要它：安卓 WebView 直连服务商会被 CORS 拦，所以开了 CapacitorHttp；
 * 但 CapacitorHttp 走桥接一次性把响应拿回来，读不到流——界面上就只能「等一坨字突然出现」。
 * 这里用 JDK 自带的 HttpURLConnection 在原生侧边读边发：
 * 每读到一行 SSE 就通过事件推给 JS，文字就能一段段出现。
 *
 * 不引 okhttp：少一个依赖，少一次联网拉包，HttpURLConnection 足够读流。
 */
@CapacitorPlugin(name = "SseStream")
public class SsePlugin extends Plugin {

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final ConcurrentHashMap<String, HttpURLConnection> running = new ConcurrentHashMap<>();
    private final Handler main = new Handler(Looper.getMainLooper());

    private void emit(final String event, final JSObject data) {
        // 事件必须回到主线程发，否则 JS 侧的监听器可能收不到
        main.post(() -> notifyListeners(event, data));
    }

    @PluginMethod
    public void post(PluginCall call) {
        final String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }
        final JSObject headers = call.getObject("headers");
        final String body = call.getString("body", "");
        final String id = UUID.randomUUID().toString();

        JSObject ret = new JSObject();
        ret.put("id", id);
        call.resolve(ret);

        pool.execute(() -> doPost(id, url, headers, body));
    }

    private void doPost(String id, String url, JSObject headers, String body) {
        HttpURLConnection conn = null;
        try {
            conn = (HttpURLConnection) new URL(url).openConnection();
            running.put(id, conn);
            conn.setRequestMethod("POST");
            conn.setDoOutput(true);
            conn.setConnectTimeout(20000);
            // 读超时按「多久没有新数据」算：长时间不出字就断，避免永远挂着
            conn.setReadTimeout(120000);
            conn.setRequestProperty("Accept", "text/event-stream");
            conn.setRequestProperty("Content-Type", "application/json");

            if (headers != null) {
                for (Iterator<String> it = headers.keys(); it.hasNext(); ) {
                    String k = it.next();
                    String v = headers.getString(k);
                    if (k != null && v != null) conn.setRequestProperty(k, v);
                }
            }

            if (body != null && !body.isEmpty()) {
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.getBytes(StandardCharsets.UTF_8));
                }
            }

            int code = conn.getResponseCode();
            JSObject start = new JSObject();
            start.put("id", id);
            start.put("status", code);
            emit("start", start);

            if (code < 200 || code >= 300) {
                InputStream errStream = conn.getErrorStream();
                StringBuilder sb = new StringBuilder();
                if (errStream != null) {
                    BufferedReader er = new BufferedReader(new InputStreamReader(errStream, StandardCharsets.UTF_8));
                    String l;
                    while ((l = er.readLine()) != null) sb.append(l);
                    er.close();
                }
                JSObject err = new JSObject();
                err.put("id", id);
                err.put("status", code);
                err.put("message", sb.length() > 1200 ? sb.substring(0, 1200) : sb.toString());
                emit("error", err);
                return;
            }

            BufferedReader reader = new BufferedReader(new InputStreamReader(conn.getInputStream(), StandardCharsets.UTF_8));
            StringBuilder batch = new StringBuilder();
            long lastEmit = System.currentTimeMillis();
            String line;
            while ((line = reader.readLine()) != null) {
                if (running.get(id) == null) break; // 已被取消
                // 攒一小批再发：逐 token 过桥太碎，40ms 一批足够顺滑
                batch.append(line).append('\n');
                long now = System.currentTimeMillis();
                if (now - lastEmit >= 40) {
                    JSObject ev = new JSObject();
                    ev.put("id", id);
                    ev.put("text", batch.toString());
                    emit("chunk", ev);
                    batch.setLength(0);
                    lastEmit = now;
                }
            }
            if (batch.length() > 0) {
                JSObject ev = new JSObject();
                ev.put("id", id);
                ev.put("text", batch.toString());
                emit("chunk", ev);
            }
            reader.close();

            JSObject done = new JSObject();
            done.put("id", id);
            emit("done", done);
        } catch (Exception ex) {
            JSObject err = new JSObject();
            err.put("id", id);
            err.put("status", 0);
            String msg = ex.getMessage();
            err.put("message", msg == null ? ex.toString() : msg);
            emit("error", err);
        } finally {
            running.remove(id);
            if (conn != null) conn.disconnect();
        }
    }

    @PluginMethod
    public void abort(PluginCall call) {
        String id = call.getString("id");
        if (id != null) {
            HttpURLConnection c = running.remove(id);
            if (c != null) c.disconnect();
        }
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (HttpURLConnection c : running.values()) {
            try {
                c.disconnect();
            } catch (Exception ignored) {
                // 关闭阶段不抛
            }
        }
        running.clear();
        pool.shutdownNow();
        super.handleOnDestroy();
    }
}
