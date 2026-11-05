<script setup lang="ts">
/**
 * 账号安全（本机账号）
 *
 * 本应用没有云端账号：手机号、微信绑定这类东西这里不存在，也不假装有。
 * 能真正做的是本机身份（头像 / 昵称 / 签名）、未成年人模式、清档注销。
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { backOr } from '../../core/nav';
import { SITE } from '../../config/site';
import { useAppStore } from '../../stores/app';
import AppAvatar from '../../components/AppAvatar.vue';
import DangerWipe from '../../components/settings/DangerWipe.vue';
import SettingGroup from '../../components/settings/SettingGroup.vue';
import SettingRow from '../../components/settings/SettingRow.vue';
import SubPage from '../../components/settings/SubPage.vue';
import { resizeImage } from '../../core/image';

const app = useAppStore();
const router = useRouter();

/** 返回上一级：有历史原路返回，没有则回设置首页 */
function back() {
  backOr(router, '/settings');
}

const fileInput = ref<HTMLInputElement | null>(null);
const uploading = ref(false);
const editingName = ref(false);
const nameDraft = ref('');
const signatureDraft = ref('');
const showWipe = ref(false);

const minorOpen = ref(false);
const minorStage = ref<'intro' | 'setup' | 'confirm-off'>('intro');
const pass1 = ref('');
const pass2 = ref('');
const passErr = ref('');
const busy = ref(false);

const name = computed(() => app.settings.profile.name || '同学');
const minor = computed(() => app.settings.minor);

async function pickAvatar(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    app.toast('只能选图片文件', 'warn');
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    app.toast('图片超过 8MB，换一张小一点的', 'warn');
    return;
  }
  uploading.value = true;
  try {
    const dataUrl = await resizeImage(file, 256);
    await app.setProfile({ avatar: dataUrl });
    app.toast('头像已更新', 'ok');
  } catch {
    app.toast('这张图读不出来，换一张试试', 'error');
  } finally {
    uploading.value = false;
    if (fileInput.value) fileInput.value.value = '';
  }
}

async function removeAvatar() {
  await app.setProfile({ avatar: null });
  app.toast('已恢复默认头像', 'info', 1600);
}

function editName() {
  nameDraft.value = name.value;
  signatureDraft.value = app.settings.profile.signature || '';
  editingName.value = true;
}

async function saveName() {
  const v = nameDraft.value.trim();
  if (!v) {
    app.toast('名字不能为空；想用默认的就填「同学」', 'warn');
    return;
  }
  if (v.length > 16) {
    app.toast('名字最多 16 个字', 'warn');
    return;
  }
  await app.setProfile({ name: v, signature: signatureDraft.value.trim().slice(0, 40) });
  editingName.value = false;
  app.toast(`以后就叫你「${v}」了`, 'ok');
}

function openMinor() {
  minorStage.value = minor.value.enabled ? 'confirm-off' : 'intro';
  pass1.value = '';
  pass2.value = '';
  passErr.value = '';
  minorOpen.value = true;
}

function checkPass(p: string): string {
  if (!/^\d{4,6}$/.test(p)) return '监护人密码用 4–6 位数字';
  return '';
}

async function enableMinor() {
  passErr.value = checkPass(pass1.value);
  if (passErr.value) return;
  if (pass1.value !== pass2.value) {
    passErr.value = '两次输入不一致';
    return;
  }
  busy.value = true;
  await app.setGuardianCode(pass1.value);
  await app.setMinor({ enabled: true });
  busy.value = false;
  minorOpen.value = false;
  app.toast('未成年人模式已开启，关闭需要监护人密码', 'ok', 3600);
}

async function disableMinor() {
  passErr.value = checkPass(pass1.value);
  if (passErr.value) return;
  busy.value = true;
  const ok = await app.verifyGuardianCode(pass1.value);
  busy.value = false;
  if (!ok) {
    passErr.value = '密码不对，未成年人模式保持开启';
    return;
  }
  await app.setMinor({ enabled: false });
  minorOpen.value = false;
  app.toast('未成年人模式已关闭', 'info');
}

function backToSettings() {
  backOr(router, '/settings');
}

const version = SITE.version;
</script>

<template>
  <SubPage title="账号安全" :subtitle="`本机账号 · 数据只存在这台设备上，不接入云端 ${version}`" @back="backToSettings">
    <!-- 头像与昵称 -->
    <div class="profile">
      <button class="avatar-btn" type="button" :disabled="uploading" @click="fileInput?.click()">
        <AppAvatar :name="name" :src="app.settings.profile.avatar" :size="88" />
        <span class="avatar-edit" aria-hidden="true">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /></svg>
        </span>
        <span v-if="uploading" class="avatar-loading" />
      </button>
      <input ref="fileInput" type="file" accept="image/*" hidden @change="pickAvatar" />

      <h2 class="nick">{{ name }}</h2>
      <p class="sig">{{ app.settings.profile.signature || '还没有签名，点下面「昵称与签名」写一句' }}</p>
      <div class="prof-actions">
        <button class="btn btn-sm" type="button" @click="editName">昵称与签名</button>
        <button v-if="app.settings.profile.avatar" class="btn btn-sm" type="button" @click="removeAvatar">恢复默认头像</button>
      </div>
    </div>

    <SettingGroup>
      <SettingRow label="本机身份" :value="`本机 · 未登录`" note="没有云端账号，也不需要手机号或微信授权">
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 12.5a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z" /><path d="M4.8 20c.6-3.6 3.6-5.6 7.2-5.6s6.6 2 7.2 5.6" /></svg>
        </template>
      </SettingRow>
      <SettingRow label="数据存放" value="仅本机" note="IndexedDB，不上传开发者服务器" chevron @click="router.push('/settings/data')">
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="6" rx="7.4" ry="3" /><path d="M4.6 6v12c0 1.7 3.3 3 7.4 3s7.4-1.3 7.4-3V6" /><path d="M4.6 12c0 1.7 3.3 3 7.4 3s7.4-1.3 7.4-3" /></svg>
        </template>
      </SettingRow>
      <SettingRow label="设备管理" :value="'1 台设备'" note="当前浏览器就是唯一设备" chevron @click="app.toast('只有这台设备，没有其他登录记录', 'info')">
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4.5" width="17" height="11" rx="2" /><path d="M8.5 20h7M12 15.5V20" /></svg>
        </template>
      </SettingRow>
      <SettingRow label="授权管理" value="无第三方授权" note="不接入微信、QQ 等第三方登录" chevron @click="app.toast('本应用没有申请任何第三方授权', 'info')">
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15.5 8.5a4.5 4.5 0 1 0-8.8 1.3L3 13.5V17h3.5v-2H9v-2h2l1.6-1.6" /><circle cx="16.8" cy="7.2" r="1.1" /></svg>
        </template>
      </SettingRow>
    </SettingGroup>

    <SettingGroup title="监护与限制">
      <SettingRow
        label="未成年人模式"
        :value="minor.enabled ? '已开启' : '去开启'"
        :note="minor.enabled ? `限制 AI 与外部链接 · 每日提醒 ${minor.dailyMinutes} 分钟` : '适龄内容、限制 AI 生成与外链，关闭需监护人密码'"
        chevron
        @click="openMinor"
      >
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5a6 6 0 0 0-6 6v3.2L4.5 16.5h15L18 12.7V9.5a6 6 0 0 0-6-6z" /><path d="M10 20a2.2 2.2 0 0 0 4 0" /></svg>
        </template>
      </SettingRow>
    </SettingGroup>

    <SettingGroup title="账号注销">
      <SettingRow label="注销并清除本机数据" value="不可恢复" danger chevron @click="showWipe = true">
        <template #icon>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M9.5 7V4.8h5V7M7 7l.8 12.2h8.4L17 7" /><path d="M10.5 10.5v5M13.5 10.5v5" /></svg>
        </template>
      </SettingRow>
    </SettingGroup>

    <p class="foot">
      注销等于清档：项目、报告、研究记录、附件与 API Key 一并删除，没有云端副本可恢复。
    </p>

    <!-- 昵称与签名 -->
    <div v-if="editingName" class="scrim" @click.self="editingName = false">
      <div class="sheet">
        <h3>昵称与签名</h3>
        <p class="sheet-note">首页会用这个名字称呼你，导出的文档署名也会用它。</p>
        <label class="field">
          <span class="field-label">昵称</span>
          <input v-model="nameDraft" class="input" maxlength="16" placeholder="同学" />
        </label>
        <label class="field">
          <span class="field-label">签名（可选）</span>
          <input v-model="signatureDraft" class="input" maxlength="40" placeholder="比如：高一（3）班 · 第三小组" />
        </label>
        <div class="actions">
          <button class="btn" type="button" @click="editingName = false">取消</button>
          <button class="btn btn-primary" type="button" @click="saveName">保存</button>
        </div>
      </div>
    </div>

    <!-- 未成年人模式 -->
    <div v-if="minorOpen" class="scrim" @click.self="minorOpen = false">
      <div class="sheet">
        <div class="umbrella" aria-hidden="true">
          <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"><path d="M3.2 12a8.8 8.8 0 0 1 17.6 0z" /><path d="M12 12v6.4a2 2 0 0 0 4 0" /></svg>
        </div>
        <h3>未成年人模式</h3>

        <template v-if="minorStage === 'intro'">
          <p class="sheet-note">
            未成年人模式是给监护人用的**本机**管理工具：只对这一台设备上的这一份数据生效。开启后，AI 生成与联网检索会受限，外链与支持入口会隐藏。它不联网、不同步，也没有「家长端」，换台设备就管不到。
          </p>
          <ul class="feat">
            <li><b>适龄内容</b><span>限制 AI 自由生成，只保留提纲与检查清单</span></li>
            <li><b>监护人管理</b><span>开启与关闭都要输入监护人密码</span></li>
            <li><b>只在本机生效</b><span>换设备或清理数据后需重新设置，无法远程同步</span></li>
          </ul>
          <div class="actions">
            <button class="btn" type="button" @click="minorOpen = false">取消</button>
            <button class="btn btn-primary" type="button" @click="minorStage = 'setup'">开始设置</button>
          </div>
        </template>

        <template v-else-if="minorStage === 'setup'">
          <p class="sheet-note">先设一个监护人密码（4–6 位数字）。它只在本机保存摘要，忘记后只能清档重来。</p>
          <label class="field">
            <span class="field-label">监护人密码</span>
            <input v-model="pass1" class="input mono" type="password" inputmode="numeric" maxlength="6" />
          </label>
          <label class="field">
            <span class="field-label">再输一次</span>
            <input v-model="pass2" class="input mono" type="password" inputmode="numeric" maxlength="6" />
          </label>
          <label class="field" v-if="!minor.enabled">
            <span class="field-label">每日使用提醒（分钟，0 = 不提醒）</span>
            <input :value="minor.dailyMinutes" class="input" type="number" min="0" max="240" @input="app.setMinor({ dailyMinutes: Number(($event.target as HTMLInputElement).value) })" />
          </label>
          <p v-if="passErr" class="err">{{ passErr }}</p>
          <div class="actions">
            <button class="btn" type="button" @click="minorOpen = false">取消</button>
            <button class="btn btn-primary" type="button" :disabled="busy" @click="enableMinor">
              {{ busy ? '处理中…' : '开启未成年人模式' }}
            </button>
          </div>
        </template>

        <template v-else>
          <p class="sheet-note">未成年人模式正在开启。关闭需要监护人密码。</p>
          <label class="field">
            <span class="field-label">监护人密码</span>
            <input v-model="pass1" class="input mono" type="password" inputmode="numeric" maxlength="6" @keyup.enter="disableMinor" />
          </label>
          <p v-if="passErr" class="err">{{ passErr }}</p>
          <div class="actions">
            <button class="btn" type="button" @click="minorOpen = false">保持开启</button>
            <button class="btn btn-danger" type="button" :disabled="busy" @click="disableMinor">
              {{ busy ? '核对中…' : '关闭' }}
            </button>
          </div>
        </template>
      </div>
    </div>

    <DangerWipe v-if="showWipe" @close="showWipe = false" />
  </SubPage>
</template>

<style scoped>
.profile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 10px 0 26px;
}
.avatar-btn {
  position: relative;
  width: 88px; height: 88px;
  padding: 0; border: none; background: transparent;
  border-radius: 50%;
  cursor: pointer;
}
.avatar-btn:active { transform: scale(0.97); }
.avatar-edit {
  position: absolute; right: -2px; bottom: -2px;
  width: 26px; height: 26px; border-radius: 50%;
  background: var(--primary); color: #fff;
  display: grid; place-items: center;
  border: 3px solid var(--bg);
}
.avatar-loading {
  position: absolute; inset: 0; border-radius: 50%;
  background: rgba(0, 0, 0, 0.45);
}
.nick { margin: 12px 0 2px; font-size: 19px; font-weight: var(--fw-strong); letter-spacing: -0.01em; }
.sig { margin: 0; font-size: 12.5px; color: var(--text-3); text-align: center; }
.prof-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; justify-content: center; }
.foot { margin: 4px 4px 0; font-size: 11.5px; line-height: 1.7; color: var(--text-3); }

.scrim {
  position: fixed; inset: 0; z-index: 110;
  background: rgba(10, 10, 12, 0.44);
  display: grid; place-items: center; padding: 20px;
  animation: fade var(--dur-2) var(--ease-out);
}
.sheet {
  width: min(420px, 100%);
  max-height: 88dvh; overflow-y: auto;
  background: var(--bg);
  border: 1px solid var(--line);
  border-radius: var(--r-4);
  box-shadow: var(--shadow-3);
  padding: 22px;
  animation: pop var(--dur-3) var(--ease-out);
}
@keyframes fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes pop { from { opacity: 0; transform: translateY(10px) scale(0.985) } to { opacity: 1; transform: none } }
.sheet h3 { margin: 0 0 8px; font-size: 17px; }
.sheet-note { margin: 0 0 6px; font-size: 12.5px; line-height: 1.7; color: var(--text-2); }
.umbrella { color: var(--primary); margin-bottom: 8px; }
.feat { list-style: none; margin: 12px 0 0; padding: 0; display: flex; flex-direction: column; gap: 12px; }
.feat li { display: flex; flex-direction: column; gap: 2px; }
.feat b { font-size: 13.5px; font-weight: var(--fw-strong); }
.feat span { font-size: 12px; color: var(--text-3); line-height: 1.6; }
.field { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
.field-label { font-size: 12px; color: var(--text-3); }
.input {
  height: 42px; padding: 0 12px;
  border: 1px solid var(--line-strong); border-radius: var(--r-1);
  background: var(--surface); color: var(--text); font: inherit; font-size: 14px;
}
.input:focus { outline: 2px solid var(--primary); outline-offset: 1px; }
.mono { font-family: var(--font-mono); letter-spacing: 0.14em; }
.err { margin: 10px 0 0; font-size: 12.5px; color: var(--danger, #c0392b); }
.actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }
@media (max-width: 520px) {
  .actions { flex-direction: column-reverse; }
  .actions .btn { width: 100%; }
}
</style>
