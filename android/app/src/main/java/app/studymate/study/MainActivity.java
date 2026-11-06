package app.studymate.study;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // 必须赶在 super.onCreate 之前注册，否则桥接初始化时拿不到这些插件
    registerPlugin(SsePlugin.class);
    registerPlugin(FilesPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
