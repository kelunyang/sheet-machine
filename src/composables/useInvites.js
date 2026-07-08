import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { gasRun } from './useGasRpc';

// 填寫者側的簽名邀請管理：查詢各格狀態、發（=重發=換Email）邀請、撤回。
// 狀態真相永遠在後端 _invites 分頁——sendInvite/revokeInvite 成功後都會 refresh；
// revoke 預設不帶 force，伺服器發現「受邀者剛簽完」會拒絕並回最新狀態，
// 這裡刷新卡片並二段確認後才 force（競態防線 #2 的前端半邊）。
export function useInvites({ currentSheet, authToken, saveDraftForInvite, onTokenExpired }) {
  // signName → { status: 'pending'|'expired'|'signed', email, expireAt, image? }；沒 key = 未邀請
  const inviteStates = ref({});
  const inviteBusy = ref(false);

  async function refreshInvites() {
    const sheet = currentSheet.value;
    if (!sheet || authToken.value === '') {
      return;
    }
    try {
      const result = await gasRun('listInvites', sheet.refer, sheet.record, authToken.value);
      if (result && result.tokenExpired) {
        onTokenExpired();
        return;
      }
      const map = {};
      if (result && result.invites) {
        for (const invite of result.invites) {
          map[invite.signName] = invite;
        }
      }
      inviteStates.value = map;
    } catch (err) {
      console.error('listInvites failed', err);
      ElMessage.error('查詢簽名邀請狀態失敗，請稍後再試');
    }
  }

  // 發邀請＝重發＝換 Email 同一支；回傳是否成功（呼叫端據此決定要不要重建簽名板）
  async function sendInvite(signName, email) {
    if (inviteBusy.value) {
      return false;
    }
    const sheet = currentSheet.value;
    if (!sheet) {
      return false;
    }
    inviteBusy.value = true;
    try {
      // 先把目前答案上雲（受邀者的 read-only 問卷讀的是線上暫存）
      const drafted = await saveDraftForInvite();
      if (!drafted) {
        ElMessage.error('上傳目前填寫進度失敗，邀請沒有送出（受邀者需要看到你的答案）');
        return false;
      }
      const result = await gasRun(
        'sendInvite',
        sheet.refer,
        sheet.record,
        authToken.value,
        signName,
        email
      );
      if (result && result.success) {
        ElMessage.success('邀請信已寄給 ' + email + '，等待對方簽名');
        await refreshInvites();
        return true;
      }
      if (result && result.tokenExpired) {
        onTokenExpired();
        return false;
      }
      ElMessage.error(result && result.message ? result.message : '發送邀請失敗');
      if (result && result.status === 'signed') {
        // 競態：這一格其實已經簽完了，刷新讓卡片顯示真實狀態
        await refreshInvites();
      }
      return false;
    } catch (err) {
      console.error('sendInvite failed', err);
      ElMessage.error('發送邀請失敗，請稍後再試');
      return false;
    } finally {
      inviteBusy.value = false;
    }
  }

  async function revokeInvite(signName) {
    if (inviteBusy.value) {
      return false;
    }
    const sheet = currentSheet.value;
    if (!sheet) {
      return false;
    }
    inviteBusy.value = true;
    try {
      let result = await gasRun(
        'revokeInvite',
        sheet.refer,
        sheet.record,
        authToken.value,
        signName,
        false
      );
      if (result && result.tokenExpired) {
        onTokenExpired();
        return false;
      }
      if (result && result.success) {
        await refreshInvites();
        ElMessage.success('已撤回「' + signName + '」的邀請，現在可以在這個裝置簽名');
        return true;
      }
      if (result && result.status === 'signed') {
        // 競態：受邀者剛簽完、你的畫面還沒刷新——先讓卡片顯示簽名，二段確認才真的撤
        await refreshInvites();
        try {
          await ElMessageBox.confirm(
            '「' +
              signName +
              '」剛剛已由受邀者（' +
              result.invite.email +
              '）完成簽名！' +
              '確定要撤銷這個已簽好的簽名、改在這個裝置重簽嗎？撤銷後對方的簽名檔會被移除。',
            '這一格已經簽名完成',
            {
              confirmButtonText: '確定撤銷，在這裡重簽',
              cancelButtonText: '保留對方的簽名',
              type: 'warning',
            }
          );
        } catch {
          return false;
        }
        const forced = await gasRun(
          'revokeInvite',
          sheet.refer,
          sheet.record,
          authToken.value,
          signName,
          true
        );
        if (forced && forced.tokenExpired) {
          onTokenExpired();
          return false;
        }
        if (forced && forced.success) {
          await refreshInvites();
          ElMessage.success('已撤銷「' + signName + '」的遠端簽名，現在可以在這個裝置重簽');
          return true;
        }
        ElMessage.error(forced && forced.message ? forced.message : '撤回失敗，請稍後再試');
        return false;
      }
      ElMessage.error(result && result.message ? result.message : '撤回失敗，請稍後再試');
      return false;
    } catch (err) {
      console.error('revokeInvite failed', err);
      ElMessage.error('撤回失敗，請稍後再試');
      return false;
    } finally {
      inviteBusy.value = false;
    }
  }

  return { inviteStates, inviteBusy, refreshInvites, sendInvite, revokeInvite };
}
