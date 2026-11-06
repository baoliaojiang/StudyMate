package app.studymate.study;

import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;

/**
 * 文件保存 / 分享 / 选择（安卓）
 *
 * 为什么不装官方 Filesystem / Share 插件：本机构建环境拉不到 npm 包，
 * 而应用需要一个"能真的把文件落到下载目录、能发给微信 QQ、能选文件读回来"的能力。
 * 这里全部用系统标准能力实现，不申请任何存储权限：
 *  - 默认保存：MediaStore.Downloads（Android 10+）写进系统下载目录；
 *  - 另存为：ACTION_CREATE_DOCUMENT，由用户自己挑位置；
 *  - 分享：缓存文件 + FileProvider + ACTION_SEND；
 *  - 导入：ACTION_OPEN_DOCUMENT 读回文本。
 * Android 9 及以下没有 MediaStore.Downloads，统一回退到 ACTION_CREATE_DOCUMENT。
 */
@CapacitorPlugin(name = "FilesBridge")
public class FilesPlugin extends Plugin {

    private static final int REQ_CREATE = 9101;
    private static final int REQ_OPEN = 9102;
    private static final int MAX_IMPORT_BYTES = 20 * 1024 * 1024;

    private PluginCall pendingSave = null;
    private byte[] pendingBytes = null;
    private PluginCall pendingOpen = null;

    @PluginMethod
    public void save(PluginCall call) {
        String b64 = call.getString("base64");
        String filename = call.getString("filename");
        String mime = call.getString("mime");
        boolean pick = call.getData().optBoolean("pick", false);
        if (b64 == null || filename == null || filename.isEmpty()) {
            call.reject("缺少文件内容或文件名");
            return;
        }
        if (mime == null || mime.isEmpty()) mime = "application/octet-stream";

        final byte[] bytes;
        try {
            bytes = Base64.decode(b64, Base64.DEFAULT);
        } catch (Exception ex) {
            call.reject("文件内容无法解码");
            return;
        }

        String safe = safeName(filename);
        // Android 10 以下没有公共下载集合；用户点「另存为」时也要弹选择器
        if (pick || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            pendingSave = call;
            pendingBytes = bytes;
            call.setKeepAlive(true);
            Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType(mime);
            intent.putExtra(Intent.EXTRA_TITLE, safe);
            try {
                startActivityForResult(call, intent, REQ_CREATE);
            } catch (Exception ex) {
                pendingSave = null;
                pendingBytes = null;
                call.reject("打不开系统保存窗口：" + message(ex));
            }
            return;
        }

        try {
            writeToDownloads(safe, mime, bytes);
            JSObject ret = new JSObject();
            ret.put("how", "downloaded");
            ret.put("note", "已保存到系统下载文件夹 / Download / StudyMate");
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("保存失败：" + message(ex));
        }
    }

    @PluginMethod
    public void share(PluginCall call) {
        String b64 = call.getString("base64");
        String filename = call.getString("filename");
        String mime = call.getString("mime");
        if (b64 == null || filename == null) {
            call.reject("缺少文件内容或文件名");
            return;
        }
        if (mime == null || mime.isEmpty()) mime = "application/octet-stream";
        try {
            byte[] bytes = Base64.decode(b64, Base64.DEFAULT);
            Context ctx = getContext();
            File dir = new File(ctx.getCacheDir(), "shared");
            if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("无法创建分享缓存目录");
            File file = new File(dir, safeName(filename));
            try (FileOutputStream fos = new FileOutputStream(file)) {
                fos.write(bytes);
            }
            Uri uri = FileProvider.getUriForFile(ctx, ctx.getPackageName() + ".fileprovider", file);

            Intent send = new Intent(Intent.ACTION_SEND);
            send.setType(mime);
            send.putExtra(Intent.EXTRA_STREAM, uri);
            send.putExtra(Intent.EXTRA_SUBJECT, filename);
            send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);

            // 部分厂商的分享面板不会透传授权，逐个目标显式授予
            PackageManager pm = ctx.getPackageManager();
            List<ResolveInfo> targets = pm.queryIntentActivities(send, PackageManager.MATCH_DEFAULT_ONLY);
            for (ResolveInfo ri : targets) {
                ctx.grantUriPermission(ri.activityInfo.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            }

            Intent chooser = Intent.createChooser(send, "分享文件");
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            chooser.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            ctx.startActivity(chooser);

            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        } catch (Exception ex) {
            call.reject("分享失败：" + message(ex));
        }
    }

    @PluginMethod
    public void pickText(PluginCall call) {
        pendingOpen = call;
        call.setKeepAlive(true);
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        // 有些文件管理器把 .json 报成 octet-stream，放宽到文本类
        intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{
                "application/json", "text/plain", "text/*", "application/octet-stream"
        });
        try {
            startActivityForResult(call, intent, REQ_OPEN);
        } catch (Exception ex) {
            pendingOpen = null;
            call.reject("打不开系统文件选择器：" + message(ex));
        }
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        super.handleOnActivityResult(requestCode, resultCode, data);

        if (requestCode == REQ_CREATE) {
            PluginCall call = pendingSave;
            byte[] bytes = pendingBytes;
            pendingSave = null;
            pendingBytes = null;
            if (call == null) return;
            if (resultCode != android.app.Activity.RESULT_OK || data == null || data.getData() == null) {
                cancelled(call);
                return;
            }
            if (bytes == null) {
                call.reject("保存内容已丢失，请重试");
                return;
            }
            try (OutputStream os = getContext().getContentResolver().openOutputStream(data.getData())) {
                if (os == null) throw new IllegalStateException("系统没有给到可写位置");
                os.write(bytes);
                JSObject ret = new JSObject();
                ret.put("how", "picked");
                ret.put("note", "已保存到你选的位置");
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("保存失败：" + message(ex));
            }
            return;
        }

        if (requestCode == REQ_OPEN) {
            PluginCall call = pendingOpen;
            pendingOpen = null;
            if (call == null) return;
            if (resultCode != android.app.Activity.RESULT_OK || data == null || data.getData() == null) {
                // 取消选择不算错误，返回不带 text 的结果
                call.resolve(new JSObject());
                return;
            }
            Uri uri = data.getData();
            try (InputStream is = getContext().getContentResolver().openInputStream(uri)) {
                if (is == null) throw new IllegalStateException("读不到这个文件");
                ByteArrayOutputStream buf = new ByteArrayOutputStream();
                byte[] chunk = new byte[8192];
                int n;
                int total = 0;
                while ((n = is.read(chunk)) > 0) {
                    total += n;
                    if (total > MAX_IMPORT_BYTES) throw new IllegalStateException("文件超过 20 MB，无法作为备份导入");
                    buf.write(chunk, 0, n);
                }
                JSObject ret = new JSObject();
                ret.put("text", new String(buf.toByteArray(), StandardCharsets.UTF_8));
                ret.put("name", displayName(uri));
                call.resolve(ret);
            } catch (Exception ex) {
                call.reject("读取文件失败：" + message(ex));
            }
        }
    }

    private void cancelled(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("how", "cancelled");
        ret.put("note", "没有保存");
        call.resolve(ret);
    }

    /** Android 10+：写进公共下载目录，不需要任何存储权限 */
    private void writeToDownloads(String filename, String mime, byte[] bytes) throws Exception {
        ContentValues cv = new ContentValues();
        cv.put(MediaStore.Downloads.DISPLAY_NAME, filename);
        cv.put(MediaStore.Downloads.MIME_TYPE, mime);
        cv.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/StudyMate");
        cv.put(MediaStore.Downloads.IS_PENDING, 1);
        Uri uri = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
        if (uri == null) throw new IllegalStateException("系统拒绝了下载目录写入");
        try (OutputStream os = getContext().getContentResolver().openOutputStream(uri)) {
            if (os == null) throw new IllegalStateException("打不开下载文件");
            os.write(bytes);
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.Downloads.IS_PENDING, 0);
        getContext().getContentResolver().update(uri, done, null, null);
    }

    private String displayName(Uri uri) {
        Cursor cursor = getContext().getContentResolver().query(uri, null, null, null, null);
        if (cursor != null) {
            try {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0 && cursor.moveToFirst()) {
                    String name = cursor.getString(idx);
                    if (name != null && !name.isEmpty()) return name;
                }
            } finally {
                cursor.close();
            }
        }
        return "backup.json";
    }

    private static String safeName(String name) {
        return name.replaceAll("[\\\\/:*?\"<>|\\r\\n]", "_").trim();
    }

    private static String message(Exception ex) {
        return ex.getMessage() == null ? ex.toString() : ex.getMessage();
    }
}
