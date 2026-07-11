<template>
  <el-drawer
    v-model="columnDialog.show"
    direction="btt"
    size="100%"
    :with-header="false"
    body-class="drawer-flow-body"
    :title="'你正在' + viewTip + '問卷：' + currentQuery">
      <div class="drawer-flow-title">你正在{{ viewTip }}問卷：{{ currentQuery }}</div>
      <LifecycleTimeline
        :start-at="currentSheet ? currentSheet.createdAt : 0"
        :end-at="currentSheet ? currentSheet.dueDate : 0"
        start-label="問卷建立"
        end-label="問卷結束"
        ended-text="已經無法填寫"
        quiet
      />
      <FormToolbar
        :show-jwt="authToken !== ''"
        :remaining-time="remainingTime"
        :session-percentage="sessionPercentage"
        :renewing="renewing"
        :temp-found="tempFound"
        :draft-enabled="draftEnabled"
        :draft-saving="draftSaving"
        :view-only="viewOnly"
        :has-last-submit="lastSubmit.length > 0"
        v-model:enable-modify="enableModify"
        @renew="handleRenewClick"
        @save-draft="saveDraftOnline()"
        @export-temp="tempTransfer.openExport()"
        @import-temp="importTempFromToolbar()"
        @download-result="downloadResult()"
      />
      <el-space direction="vertical" fill wrap style="width: 100%">
        <el-alert title="問卷提示" type="warning" show-icon v-if="alertWords !== ''" v-show="scriptError.message === ''">
          <template #default>
            <span style="font-size: 1.5em" v-html="HTMLConverter(alertWords)"></span>
          </template>
        </el-alert>
        <ErrorAlert :message="scriptError.message" />
        <el-alert title="填寫狀態" type="info" show-icon v-if="scriptError.message === ''">
          <template #default>
            <span style="font-size: 1.5em" v-if="requestCount.length > 0">
              你填過了{{ requestCount.length }}次，最後一次是在{{ dateConverter(requestCount.lastTick) }}填的{{ tempFound ? "，本機有你之前沒送出的存檔（檔案欄位不會存檔），已載入" : "，系統會在下面顯示你上次填寫的結果" }}，如果你沒有要更新可以不用一直來填寫，關閉視窗即可
            </span>
            <span style="font-size: 1.5em" v-if="requestCount.length === 0">
              共 {{ totalInputs.true }} 題，你沒有填過{{ tempFound ? "，但本機有你之前沒送出的存檔（檔案欄位不會存檔），已載入" : "，系統會自動暫存你輸入的結果，請放心輸入" }}
            </span>
          </template>
        </el-alert>
        <FieldTimeline v-if="!viewOnly" :columns="columnDB" />
        <FormField
          v-for="dataColumn in columnDB"
          :key="dataColumn.tid"
          :id="'formfield-' + dataColumn.tid"
          :column="dataColumn"
          :column-db="columnDB"
          :enable-modify="enableModify"
          @query-pc="queryPC"
          @upload-file="uploadFile"
          @multi-select="multiSelect"
        />
      </el-space>
      <template #footer>
        <div class="formFooter">
          <div class="formFooter__hint" v-if="!viewOnly && !enableModify">
            問卷目前唯讀，想修改請點上方「目前唯讀，點我修改」按鈕解鎖
          </div>
          <div class="formFooter__hint" v-else-if="!viewOnly && checkData()">
            請確認必填欄位都已填，並且不可以有格式錯誤（紅字）才可以送出喔！
          </div>
          <div class="formFooter__buttons">
            <el-button v-if="tempFound" size="large" type="danger" v-on:click="clearTemp()">清除暫存答案（會重新載入問卷）</el-button>
            <el-button v-else size="large" type="info" v-on:click="endView()">檢視完畢</el-button>
            <el-button v-if="!viewOnly" size="large" type="primary" v-on:click="authMod()" :disabled="!enableModify || checkData()" :loading="submitChecking">{{ submitButtonText }}</el-button>
          </div>
        </div>
      </template>
  </el-drawer>
  <el-drawer
    :with-header="false"
    body-class="drawer-flow-body"
    v-model="sheetsDialog.show"
    direction="btt"
    size="100%"
    title="可供檢視／填答的表單">
    <div class="drawer-flow-title">可供檢視／填答的表單</div>
    <JwtCountdownBar
      v-if="authToken !== ''"
      class="drawer-sticky-top"
      :remaining-time="remainingTime"
      :session-percentage="sessionPercentage"
      :renewing="renewing"
      @renew="handleRenewClick"
    />
    <ErrorAlert :message="scriptError.message" />
    <el-space direction="vertical" fill wrap style="width: 100%">
      <el-alert
        title="重要公告"
        type="warning"
        show-icon
        :closable="false"
        class="ma1 xs12"
        v-if="announcement !== ''">
        <div class="breakword" v-html="HTMLConverter(announcement)"></div>
      </el-alert>
      <div class="xs12" style="font-size: 1em; color: #666; text-align: center;" v-if="sheets.length === 0">無資料</div>
      <SheetCard
        v-for="sheet in sheets"
        :key="sheet.id"
        :sheet="sheet"
        @open="openSheet(sheet.id)"
      />
      <el-button class="ma1 pa2 xs12" size="large" type="info" v-on:click="inviteCodeDialog.show = true">
        我有簽名邀請碼（我只是簽名者之一）
      </el-button>
      <AppFooter />
    </el-space>
  </el-drawer>
  <el-drawer
    :with-header="false"
    body-class="drawer-flow-body"
    v-model="signatureDialog.show"
    direction="btt"
    size="100%"
    :title="'簽名確認（本表單共需' + allSignNames.length + '組簽名）'">
    <div class="drawer-flow-title">簽名確認（本表單共需{{ allSignNames.length }}組簽名）</div>
    <SignatureToolbar
      :show-jwt="authToken !== ''"
      :remaining-time="remainingTime"
      :session-percentage="sessionPercentage"
      :renewing="renewing"
      :signature-count="signatures.length"
      :current-index="currentSignature"
      :can-invite="draftEnabled && !viewOnly"
      :invite-busy="inviteBusy"
      :has-invites="hasInviteCards"
      @renew="handleRenewClick"
      @next="nextSignature()"
      @clear="clearSignature()"
      @invite="inviteSlot(signatureTip)"
      @refresh="refreshInviteStates()"
    />
    <el-alert title="簽名不得為空" type="error" show-icon v-if="emptySignatures.length > 0">
      <template #default>
        <span style="font-size: 1.5em">
          {{ emptySignatures.join("、") }}的簽名不得留空，否則無法繼續提交問卷！（你忘記按上方的「下一個簽名」？）
        </span>
      </template>
    </el-alert>
    <el-alert title="你已經提交過簽名了" type="warning" show-icon v-if="savedSignatures.length > 0">
      <template #default>
        <span style="font-size: 1.5em">
          以下是你提交過的簽名存檔，再次提交會洗掉舊的簽名喔！
        </span>
        <div>
          <img
            v-for="(sign, k) in savedSignatures"
            :key="'sign' + k"
            :src="sign"
            :alt="'第' + (k + 1) + '個存檔簽名'"
            class="savedSignatureImg"
          />
        </div>
      </template>
    </el-alert>
    <el-space direction="vertical" :fill="true" wrap style="width: 100%">
      <template v-for="name in allSignNames" :key="'invite-' + name">
        <el-card v-if="inviteStateFor(name).status !== 'none'" shadow="never">
          <template #header>
            <div class="inviteCardHeader">
              <div class="inviteCardHeader__title">
                <span style="font-weight: bold; font-size: 1.2em">「{{ name }}」的簽名</span>
                <el-tag
                  :type="inviteStateFor(name).status === 'signed' ? 'success' : inviteStateFor(name).status === 'expired' ? 'danger' : 'warning'">
                  {{ inviteStateFor(name).status === 'signed' ? '已簽名' : inviteStateFor(name).status === 'expired' ? '邀請已過期' : '授權中' }}
                </el-tag>
              </div>
              <!-- 已簽名格只有 2 顆操作，攤平不做單項 dropdown；pending/expired 攤平主行動、其餘收進「更多 ▾」 -->
              <div class="inviteCardHeader__actions" v-if="inviteStateFor(name).status === 'signed'">
                <el-button size="large" type="primary" :loading="inviteBusy" v-on:click="resendSlot(name)">
                  簽名有問題？作廢舊簽名重發
                </el-button>
                <el-button size="large" type="danger" :loading="inviteBusy" v-on:click="revokeSlot(name)">
                  撤回這個簽名，在本機重簽
                </el-button>
              </div>
              <div class="inviteCardHeader__actions" v-else>
                <el-button size="large" type="primary" :loading="inviteBusy" v-on:click="resendSlot(name)">
                  重發授權信
                </el-button>
                <el-dropdown trigger="click" @command="(command) => onInviteCommand(command, name)">
                  <el-button size="large" type="info" :loading="inviteBusy">
                    更多<el-icon class="el-icon--right"><i class="fa-solid fa-chevron-down"></i></el-icon>
                  </el-button>
                  <template #dropdown>
                    <el-dropdown-menu>
                      <el-dropdown-item command="change">更換簽名者Email</el-dropdown-item>
                      <el-dropdown-item command="revoke" divided>撤回授權，在這個裝置簽名</el-dropdown-item>
                    </el-dropdown-menu>
                  </template>
                </el-dropdown>
              </div>
            </div>
          </template>
          <div v-if="inviteStateFor(name).status === 'signed'">
            <img :src="inviteStateFor(name).image" :alt="name + '的遠端簽名'" class="savedSignatureImg" />
            <div class="captionWord">已由受邀者（{{ inviteStateFor(name).email }}）遠端簽署完成，這一格會直接使用這個簽名送出</div>
          </div>
          <div v-else>
            <div class="captionWord">
              已邀請 {{ inviteStateFor(name).email }}（{{ inviteStateFor(name).status === 'expired' ? '已於' : '有效至' }}{{ dateConverter(inviteStateFor(name).expireAt) }}{{ inviteStateFor(name).status === 'expired' ? '過期' : '' }}），等待對方簽名中；對方簽完之前你無法送出問卷。對方簽好後，請你按最上方的「更新邀請狀態」載入
            </div>
          </div>
        </el-card>
      </template>
      <template v-if="signatures.length > 0">
        <el-alert :title="'你正在簽第' + (currentSignature + 1) + '組簽名，本機共' + signatures.length + '組'" type="warning" show-icon>
          <template #default>
            <span style="font-size: 1.5em">
              <span style="font-weight: bold;">請在灰框內簽下「 {{ signatureTip }}」的簽名（需在本機簽{{ signatures.length }}組，這是第{{ currentSignature + 1 }}組）</span>，請注意，簽名需親簽（或得到授權），否則可能違反刑法217條偽造署押罪</span>
          </template>
        </el-alert>
        <el-carousel ref="signaturePad" :autoplay="false" indicator-position="none" arrow="never" @change="changeSignature">
          <el-carousel-item v-for="signature in signatures" :key="signature.id">
            <el-progress :percentage="signature.percentage" :status="signature.progressStatus">
              <template #default="{ percentage }">
                <span>{{ percentage }}%</span>
                <span v-if="signature.showWarning" style="color: red;">
                  簽名須佔有簽名板的0.5%以上面積
                </span>
              </template>
            </el-progress>
            <canvas class="signaturePad" :width="signatureWidth" :height="signatureHeight" />
          </el-carousel-item>
        </el-carousel>
      </template>
      <el-alert v-else-if="pendingInviteNames.length === 0 && allSignNames.length > 0" title="全部簽名已完成" type="success" show-icon>
        <template #default>
          <span style="font-size: 1.5em">所有簽名格都已完成（含遠端簽名），請按下方按鈕繼續</span>
        </template>
      </el-alert>
    </el-space>
    <template #footer>
      <div class="formFooter">
        <div class="formFooter__buttons">
          <el-button size="large" type="primary" v-on:click="reverseBody()">剛剛輸入的有誤，回去修改</el-button>
          <el-button size="large" type="danger" v-on:click="endSignature()" :disabled="signatureSubmitStatus.isDisabled">{{ signatureSubmitStatus.message }}</el-button>
        </div>
      </div>
    </template>
  </el-drawer>
  <el-drawer
    :with-header="false"
    body-class="drawer-flow-body"
    v-model="loginDialog.show"
    direction="btt"
    size="100%"
    :title="'確認身分以' + viewTip + '問卷：'+currentQuery">
    <div class="drawer-flow-title">確認身分以{{ viewTip }}問卷：{{ currentQuery }}</div>
    <LifecycleTimeline
      :start-at="currentSheet ? currentSheet.createdAt : 0"
      :end-at="currentSheet ? currentSheet.dueDate : 0"
      start-label="問卷建立"
      end-label="問卷結束"
      ended-text="已經無法填寫"
    />
    <el-alert title="確認身分中" type="info" show-icon v-if="loginStatus">
      <template #default>
        <span style="font-size: 1.5em">
          正在確認你的身分以及查詢你是否有填過，請稍候
        </span>
      </template>
    </el-alert>
    <el-alert title="Google帳號狀態" type="info" show-icon v-if="googleStatus !== undefined">
      <template #default>
        <span style="font-size: 1.5em">
          {{ googleStatus === '' ? '你還沒登入Google帳號吧？開個新分頁登入之後重新整理本頁就可以了' : '目前登入的Gmail帳號是：' + googleStatus }}
        </span>
      </template>
    </el-alert>
    <el-alert title="表單關閉" type="warning" show-icon v-if="!writeAllowed">
      <template #default>
        <span style="font-size: 1.5em">
          本表單暫時關閉，有任何問題請洽管理員
        </span>
      </template>
    </el-alert>
    <el-alert :title="saveSuccessed ? '儲存成功' : '儲存失敗'" :type="saveSuccessed ? 'success' : 'error'" show-icon v-if="saveSuccessed !== undefined">
      <template #default>
        <span style="font-size: 1.5em">
          {{ saveSuccessed ? dateConverter(writeTick) + "已寫入，如果想查詢你最後一次填寫結果，重新登入即可查看" : "你輸入的格式錯誤，請依照下面訊息重新修正" }}
        </span>
      </template>
    </el-alert>
    <ErrorAlert :message="scriptError.message" />
    <el-alert title="問卷提示" type="warning" show-icon v-show="scriptError.message === '' && saveSuccessed === undefined">
      <template #default>
        <span style="font-size: 1.5em" v-html='HTMLConverter(loginTip)'></span>
      </template>
    </el-alert>
    <el-space direction="vertical" fill wrap style="width: 100%">
      <div class="qTitle xs12" v-if="saveSuccessed" v-html='HTMLConverter(submitTip)'></div>
      <el-space direction="vertical" fill wrap class="ma1 pa2 xs12" v-for="authColumn in authDB" :key="authColumn.tid">
        <div class="qTitle xs12" v-if="!/G/.test(authColumn.type)">{{ authColumn.name }}</div>
        <el-input
          v-if="formatDetector('I|N|T|E|M', 'A|P', authColumn)"
          size="large"
          class="xs12"
          :label="authColumn.name"
          v-model="authColumn.value"
          :show-password="/P/.test(authColumn.type)"
          v-on:change="valField(authColumn)"
          outline>
        </el-input>
        <el-select
          v-if="formatDetector('S', 'A|P', authColumn)"
          v-model="authColumn.value"
          class="xs12"
          :placeholder="authColumn.name"
          v-on:change="valField(authColumn)"
          size="large">
          <el-option
            v-for="item in authColumn.content.split(';')"
            :key="item+authColumn.tid+'key'"
            :label="item"
            :value="item"
          />
        </el-select>
        <el-button v-if="formatDetector('G', 'P', authColumn)" class="ma1 pa2 xs12" size="large" type="danger" v-on:click="loginGmail(authColumn)" v-show="!loginStatus">按此驗證你的Google帳號以進入表單</el-button>
        <div class="alertWord" v-if="authColumn.status !== ''">{{ authColumn.status }}</div>
        <div class="captionWord" v-if="authColumn.status === ''">{{ formatHelper(authColumn) }}</div>
      </el-space>
      <el-button v-if="authtypeCheck()" class="ma1 pa1 xs12" size="large" type="danger" :disabled="checkAuth()" v-show="!loginStatus" v-on:click="loginView()">{{ checkAuth() ? "格式錯誤或有空值，修正後才可以送出" : "送出認證以" + viewTip + "表單" }}</el-button>
      <el-button v-if="saveSuccessed" class="ma1 pa2 xs12" size="large" type="success" v-on:click="downloadResult()">下載你剛剛填寫的結果</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="viewStat()" v-if="!loginStatus">查看填答率統計 </el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="sendContact()" v-show="!loginStatus" v-if="contactEmail !== ''">Email給問卷負責人</el-button>
      <AppFooter />
    </el-space>
  </el-drawer>
  <FileUploadDrawer
    v-model:show="fileDrawer.show"
    :column="fileDrawer.column"
    :sheet="currentSheet"
    :auth-token="authToken"
    @uploaded="applyFileUpload"
    @token-expired="handleTokenExpired"
  />
  <MultiSelectDrawer
    v-model:show="multiDrawer.show"
    :column="multiDrawer.column"
    @done="applyMultiSelection"
  />
  <el-drawer
    v-model="confirmDialog.show"
    title="確定要送出了嗎？"
    direction="ttb"
    :show-close="false"
    size="60%"
  >
    <el-alert title="上傳中" type="info" show-icon v-if="uploadStatus">
      <template #default>
        <span style="font-size: 1.5em">
          上傳可能會花上一段時間，在本訊息結束之前，請不要關閉視窗
        </span>
      </template>
    </el-alert>
    <ErrorAlert :message="scriptError.message" />
    <el-space direction="vertical" fill wrap style="width: 100%">
      <div class="qTitle">你確定資料無誤，可以送出了嗎？</div>
      <el-switch class="ma1" size="large" :active-text="'請寄一個確認信給我（本日剩餘Email通知信配額' + remainEmail  + '封）'" v-model="emailObj.enable" v-if="remainEmail > 0"></el-switch>
      <el-input
        v-if="emailObj.enable"
        v-show="remainEmail > 0"
        size="large"
        class="xs12"
        label="請在此輸入你的Email，系統會把你這次填寫的結果Email給你"
        v-model="emailObj.value"
        v-on:change="valField(emailObj)"
        outline>
      </el-input>
      <div class="alertWord" v-if="emailObj.status !== ''" v-show="emailObj.enable">{{ emailObj.status }}</div>
      <el-button class="ma1 pa2 xs12" size="large" type="danger" v-on:click="sendMod()" :disabled="checkSend()" v-if="!uploadStatus">{{ checkSend() ? "請修正你提供的Email格式，才能送出" : "是的，我確定送出本次填寫的結果！" }}</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="reverseBody()" v-if="!uploadStatus">剛剛輸入的有誤，回去修改</el-button>
    </el-space>
  </el-drawer>
  <el-drawer
    v-model="inviteCodeDialog.show"
    title="我有簽名邀請碼（我只是簽名者之一）"
    direction="ttb"
    :show-close="false"
    size="60%"
    @close="handleInviteCodeClosed"
  >
    <el-space direction="vertical" fill wrap style="width: 100%">
      <template v-if="!inviteOtpStep">
        <el-input
          v-model="inviteCodeInput"
          size="large"
          placeholder="貼上邀請信中的邀請碼；系統會再寄一組 6 位數驗證碼到受邀信箱"
          clearable
        />
        <el-button class="ma1 pa2 xs12" size="large" type="primary" :loading="inviteChecking" v-on:click="confirmInviteCode()">確認邀請碼</el-button>
      </template>
      <template v-else>
        <el-alert title="驗證碼已寄出" type="info" show-icon :closable="false">
          <template #default>
            <span style="font-size: 1.5em">
              系統已寄一組 6 位數驗證碼到 {{ inviteMaskedEmail }}（10 分鐘內有效）。
              請查收信箱（含垃圾信件匣），輸入驗證碼後即可檢視問卷並簽名。
            </span>
          </template>
        </el-alert>
        <PinCodeInput
          ref="invitePinRef"
          v-model="inviteOtpInput"
          :length="6"
          :pin-group-size="3"
          input-mode="numeric"
          :disabled="inviteVerifying"
          @complete="verifyInviteOtp()"
        />
        <el-button
          class="ma1 pa2 xs12"
          size="large"
          type="primary"
          :loading="inviteVerifying"
          :disabled="!/^\d{6}$/.test(inviteOtpInput.trim())"
          v-on:click="verifyInviteOtp()"
        >
          送出驗證碼
        </el-button>
        <el-button
          class="ma1 pa2 xs12"
          size="large"
          type="info"
          :loading="inviteResending"
          :disabled="inviteResendCooldown > 0"
          v-on:click="sendInviteOtp(true)"
        >
          {{ inviteResendCooldown > 0 ? '重寄驗證碼（' + inviteResendCooldown + ' 秒後可重寄）' : '重寄驗證碼' }}
        </el-button>
      </template>
      <el-button class="ma1 pa2 xs12" size="large" type="info" v-on:click="inviteCodeDialog.show = false">取消</el-button>
    </el-space>
  </el-drawer>
  <TempTransferDrawers
    ref="tempTransfer"
    :auth-db="authDB"
    :column-db="columnDB"
    :uid="currentUID"
    :sid="currentSID"
    :sheet-name="currentQuery"
    :jwt-visible="authToken !== ''"
    :remaining-time="remainingTime"
    :session-percentage="sessionPercentage"
    :renewing="renewing"
    @imported="tempFound = true"
    @renew="handleRenewClick"
  />
  <LatestDialog ref="latestDialogRef" :sheet="currentSheet" :pkey-name="pkeyName" />
  <StatDialog ref="statDialogRef" :sheet="currentSheet" :sheet-name="currentQuery" />
  <InviteeSignDialog ref="inviteeDialogRef" @closed="handleInviteeClosed" />
  <ConfirmDrawer />
  <LoadingGame v-if="loadingGameVisible" />
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import { drawerPrompt } from './composables/useConfirmDrawer';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import _ from 'lodash';
import { getTagPalette } from './theme/colors.config.js';
import FormField from './components/FormField.vue';
import FormToolbar from './components/FormToolbar.vue';
import SignatureToolbar from './components/SignatureToolbar.vue';
import AppFooter from './components/AppFooter.vue';
import SheetCard from './components/SheetCard.vue';
import FieldTimeline from './components/FieldTimeline.vue';
import LifecycleTimeline from './components/LifecycleTimeline.vue';
import ConfirmDrawer from './components/ConfirmDrawer.vue';
import ErrorAlert from './components/ErrorAlert.vue';
import MultiSelectDrawer from './components/MultiSelectDrawer.vue';
import FileUploadDrawer from './components/FileUploadDrawer.vue';
import TempTransferDrawers from './components/TempTransferDrawers.vue';
import LatestDialog from './components/LatestDialog.vue';
import StatDialog from './components/StatDialog.vue';
import JwtCountdownBar from './components/JwtCountdownBar.vue';
import InviteeSignDialog from './components/InviteeSignDialog.vue';
import PinCodeInput from './components/PinCodeInput.vue';
import LoadingGame from './components/LoadingGame.vue';
import { dateConverter, downloadCSV } from './utils/formatters';
import { htmlConverter } from './utils/markdown';
import {
  formatDetector,
  formatHelper,
  findPrimaryKey,
  findGmailPrimary,
  validateColumn,
} from './utils/columnRules';
import { prepareColumnsForDisplay } from './utils/columnPrep';
import { buildTempQueue, hasFilledData } from './utils/tempQueue';
import { upsertQueue, clearQueue, clearSubmitted, loadOrCreateAns } from './utils/tempStorage';
import { gasRun, plainClone } from './composables/useGasRpc';
import { useSignatures } from './composables/useSignatures';
import { useDraft } from './composables/useDraft';
import { useInvites } from './composables/useInvites';
import { useJwtSession } from './composables/useJwtSession';
import { useLoadingGame, beginLoading } from './composables/useLoadingGame';

// ===== 基本狀態 =====
const tempFound = ref(false);
const sheetLoaded = ref(false);
const currentUID = ref('');
const currentSID = ref('');
const currentDue = ref(0);
const viewDate = ref(0);
const viewOnly = ref(false);
const currentQuery = ref('');
const alertWords = ref('這份問卷涉及到你的大考報名地址，請謹慎填寫！');
const loginTip = ref('');
const submitTip = ref('');
const contactEmail = ref('');
const writeAllowed = ref(false);
const remainEmail = ref(0);
const pkeyName = ref('');
const loginStatus = ref(false);
const googleStatus = ref(undefined);
const saveSuccessed = ref(undefined);
const uploadingSheet = ref(false);
const uploadStatus = ref(false);
const savedSignatures = ref([]);
const writeTick = ref(0);
const lastSubmit = ref([]);
const scriptError = ref({ message: '' });
const columnDB = ref([]);
const authDB = ref([]);
// 登入後的 JWT：特權 RPC 只帶它，認證欄位值（個資）不再重傳（Phase 5）
const authToken = ref('');
const enableModify = ref(false);
const sheets = ref([]);
// 問卷列表頁重要公告（Markdown 原文，後端 getAnnouncement 供應，空字串＝不顯示）
const announcement = ref('');
const tagPalette = getTagPalette();
const requestCount = ref({ pkey: '', modified: false, length: 0, lastTick: 0 });

const emailObj = reactive({
  value: '',
  nullable: false,
  type: 'F',
  status: '請輸入一個Email',
  format: 'E',
  enable: false,
});

// 對話框開關
// Phase 7：主流程全部改用 btt 100% el-drawer，fullscreen 欄位隨 el-dialog 一起退場
// 送出修改後、進簽名步驟前的邀請狀態查詢中（按鈕 loading，drawer 保持開啟）
const submitChecking = ref(false);
const sheetsDialog = reactive({ show: true });
const loginDialog = reactive({ show: false });
const columnDialog = reactive({ show: false });
const signatureDialog = reactive({ show: false });
const confirmDialog = reactive({ show: false });
const inviteCodeDialog = reactive({ show: false });
const multiDrawer = reactive({ show: false, column: null });
const fileDrawer = reactive({ show: false, column: null });

// template refs
const tempTransfer = ref(null); // TempTransferDrawers
const latestDialogRef = ref(null); // LatestDialog
const statDialogRef = ref(null); // StatDialog
const signaturePad = ref(null); // el-carousel
const inviteeDialogRef = ref(null); // InviteeSignDialog

// 受邀簽名者入口：首屏手動貼邀請碼（?token= 直連入口保留，但邀請信不再附連結
// ——GAS 網址會觸發 outlook.com 等的釣魚過濾，連結由填寫者自行分享）。
// 邀請碼確認與 email OTP 驗證都在 inviteCodeDialog 同一個 drawer 內完成，
// OTP 通過才開 InviteeSignDialog（開啟時問卷內容已就緒）
const inviteCodeInput = ref('');
const inviteOtpStep = ref(false); // OTP 已寄出，drawer 切到驗證碼輸入
const inviteOtpInput = ref('');
const invitePinRef = ref(null); // PinCodeInput（清空重試時 reset + 聚焦第一格）
const inviteMaskedEmail = ref('');
const inviteChecking = ref(false); // 確認邀請碼＋寄 OTP 中
const inviteVerifying = ref(false); // inviteeLogin 驗證中
const inviteResending = ref(false); // 重寄 OTP 中
const inviteResendCooldown = ref(0);
let inviteCooldownTimer = null;
let enteringInvitee = false; // OTP 通過的轉場旗標：drawer @close 時不要導回列表

// ===== composables =====
const {
  signatures,
  currentSignature,
  emptySignatures,
  enableSignature,
  signatureWidth,
  signatureHeight,
  signatureTip,
  signatureSubmitStatus,
  resetSignatures,
  addSignatures,
  initSignaturePads,
  setupOrientationListener,
  clearSignature,
  changeSignature,
  nextSignature: switchToNextSignature,
  findEmptySignatures,
  collectSignatures,
} = useSignatures();
const {
  draftEnabled,
  draftSaving,
  saveDraftOnline,
  saveDraftForInvite,
  checkOnlineDraft,
} = useDraft({
  sheets,
  currentSID,
  currentUID,
  authDB,
  columnDB,
  tempFound,
  authToken,
  onTokenExpired: handleTokenExpired,
});
const { remainingTime, sessionPercentage, renewing, handleRenewClick } = useJwtSession({
  token: authToken,
  onRenew: renewAuthToken,
  onExpired: handleTokenExpired,
});
// 8-bit loading game（Phase 8）：RPC 等待時浮出遊戲卡，visible 由 beginLoading 計數器驅動
const { loadingGameVisible } = useLoadingGame();
const {
  inviteStates,
  inviteBusy,
  refreshInvites,
  sendInvite: sendInviteRpc,
  revokeInvite: revokeInviteRpc,
} = useInvites({
  currentSheet: computed(() => currentSheet.value),
  authToken,
  saveDraftForInvite,
  onTokenExpired: handleTokenExpired,
});

// 模板沿用原本的方法名
const HTMLConverter = htmlConverter;

// ===== computed =====
const totalInputs = computed(() => {
  return _.countBy(columnDB.value, (column) => {
    return /F/.test(column.type);
  });
});

const viewTip = computed(() => {
  return viewOnly.value ? '檢視' : '檢視&填寫';
});

// 目前開啟的問卷（供抽出去的元件自己打 RPC 用）
const currentSheet = computed(() => {
  return _.find(sheets.value, (sheet) => sheet.id === currentSID.value) || null;
});

const expired = computed(() => {
  let now = dayjs().valueOf();
  return ((currentDue.value - now) / 1000).toFixed(0);
});

// ===== 簽名邀請狀態（填寫者側） =====
// 問卷設定的全部簽名格（邀請後 useSignatures 的 signatures 只剩本機簽的格，兩者要分開）
const allSignNames = computed(() => {
  return currentSheet.value ? currentSheet.value.signatures : [];
});

function inviteStateFor(name) {
  return inviteStates.value[name] || { status: 'none' };
}

const hasInviteCards = computed(() => {
  return _.some(allSignNames.value, (name) => inviteStateFor(name).status !== 'none');
});

// 填寫 drawer footer 主按鈕：有簽名格的表在按鈕文案預告下一步是簽名（Phase 13，
// el-steps 退役後「後面還有簽名」的預告搬到這裡）
const submitButtonText = computed(() => {
  return allSignNames.value.length > 0 ? '完成填寫，前往簽名' : '送出修改';
});

// 還在等受邀者簽的格（含過期）：送出前必須清空——重發、等對方簽完、或撤回改本機簽
const pendingInviteNames = computed(() => {
  return _.filter(allSignNames.value, (name) => {
    return /pending|expired/.test(inviteStateFor(name).status);
  });
});

// ===== 本機暫存：columnDB 一變動就寫回 localStorage =====
watch(
  columnDB,
  (newValue) => {
    if (sheetLoaded.value) {
      let tempQueue = buildTempQueue(newValue);
      let primaryKey = findPrimaryKey(authDB.value);
      if (primaryKey !== undefined) {
        upsertQueue(primaryKey.value, currentUID.value, tempQueue);
        // 有欄位的值與原始值（savedContent）不同才算有暫存
        tempFound.value = hasFilledData(tempQueue, newValue);
      }
    }
  },
  { deep: true }
);

// 匯入會回寫欄位值，從工具列匯入時自動解鎖成修改模式，匯入完使用者才看得到值進了欄位
function importTempFromToolbar() {
  enableModify.value = true;
  tempTransfer.value.openImport();
}

function clearTemp() {
  let primaryKey = findPrimaryKey(authDB.value);
  if (primaryKey !== undefined) {
    if (clearQueue(primaryKey.value, currentUID.value)) {
      reloadPage();
    } else {
      ElMessage('找不到你的存檔值，確定這是從正常流程中呼叫的？');
    }
  } else {
    ElMessage('找不到你的問卷唯一值，確定這是從正常流程中呼叫的？');
  }
}

// ===== 一般工具 =====
function sendContact() {
  let element = document.createElement('a');
  element.setAttribute('href', 'mailto:' + contactEmail.value);
  element.setAttribute('target', '_blank');
  element.click();
}

function authtypeCheck() {
  if (authDB.value.length > 0) {
    return findGmailPrimary(authDB.value) === undefined;
  }
  return false;
}

function checkSend() {
  if (emailObj.enable) {
    if (emailObj.status === '') {
      return false;
    }
    return true;
  } else {
    return false;
  }
}

function valField(column) {
  validateColumn(column, columnDB.value);
}

// ===== 多選欄位 =====
function multiSelect(dataColumn) {
  if (formatDetector('U', 'F', dataColumn)) {
    multiDrawer.column = dataColumn;
    multiDrawer.show = true;
  }
}

function applyMultiSelection(selected) {
  if (multiDrawer.column) {
    multiDrawer.column.value = _.join(selected, ';');
    valField(multiDrawer.column);
  }
}

// ===== 下載結果 =====
function downloadResult() {
  let result = [];
  for (let i = 0; i < lastSubmit.value.length; i++) {
    let data = lastSubmit.value[i];
    result.push({
      欄位名稱: data.name,
      你填寫的值: data.value,
    });
  }
  downloadCSV(result, '你填寫的結果', writeTick.value);
}

// ===== 問卷列表 =====
async function loadSheet() {
  // loading 進度交給遊戲卡的 label 顯示，不再另發 toast
  const endLoading = beginLoading('問卷列表載入中');
  try {
    const [list, announce] = await Promise.all([
      gasRun('getQList'),
      gasRun('getAnnouncement'),
    ]);
    announcement.value = typeof announce === 'string' ? announce : '';
    scriptError.value.message = '';
    for (let i = 0; i < list.length; i++) {
      let tags = list[i].name.match(/\[[^\]]+\]/g);
      list[i].tags = [];
      if (tags !== null) {
        for (let k = 0; k < tags.length; k++) {
          list[i].tags.push({
            name: tags[k].replace(/\[|\]/g, ''),
            color: tagPalette[(i * 10 + k) % tagPalette.length],
            id: uuidv4(),
          });
        }
      }
      list[i].name = list[i].name.match(/(?:.(?!\S*\]))+/)[0].replace(/\]/, '');
      list[i].id = uuidv4();
    }
    sheets.value = list;
    saveSuccessed.value = undefined;
    requestCount.value.pkey = '';
    lastSubmit.value = [];
    authToken.value = '';
    resetSignatures();
    sheetsDialog.show = true;
    consumeSheetDeepLink(list);
  } catch (err) {
    scriptError.value = err;
  } finally {
    endLoading();
  }
}

// ===== 問卷深連結（?sheet=<referSSID>，由後端 doGet 驗證格式後注入）=====
// 一次性旗標：onMounted 填入，首次載入列表後比對消費
let pendingSheetRefer = '';

function consumeSheetDeepLink(list) {
  if (pendingSheetRefer === '') {
    return;
  }
  const refer = pendingSheetRefer;
  pendingSheetRefer = '';
  const match = _.find(list, (item) => item.refer === refer);
  if (match === undefined) {
    ElMessage.warning('找不到連結指定的問卷（可能已下架或連結有誤），請從列表選擇');
  } else if (!match.writeAllowed) {
    ElMessage.warning('連結指定的問卷目前關閉中，有問題請洽管理員');
  } else {
    openSheet(match.id);
  }
}

async function openSheet(sid) {
  let sheet = _.filter(sheets.value, (item) => {
    return item.id === sid;
  });
  ElMessage('載入問卷中，請稍後');
  if (sheet.length > 0) {
    try {
      const headers = await gasRun('publicHeader', sheet[0].refer);
      let now = dayjs().valueOf();
      enableModify.value = sheet[0].enableModify;
      scriptError.value.message = '';
      currentSID.value = sheet[0].id;
      currentUID.value = sheet[0].sheetID;
      currentDue.value = sheet[0].dueDate;
      viewDate.value = sheet[0].viewDate;
      currentQuery.value = sheet[0].name;
      loginTip.value = sheet[0].loginTip;
      alertWords.value = sheet[0].comment;
      submitTip.value = sheet[0].submitTip;
      writeAllowed.value = sheet[0].writeAllowed;
      contactEmail.value = sheet[0].email;
      addSignatures(sheet[0].signatures);
      if (expired.value <= 0 && now < viewDate.value) {
        viewOnly.value = true;
        enableModify.value = false;
      }
      for (let i = 0; i < headers.length; i++) {
        headers[i].tid = uuidv4();
        headers[i].status = '';
      }
      if (sheet[0].writeAllowed) {
        authDB.value = _.filter(headers, (header) => {
          return /A|P/.test(header.type);
        });
        let gmailPrimary = findGmailPrimary(authDB.value);
        if (gmailPrimary !== undefined) {
          authDB.value = [gmailPrimary];
        }
      }
      let pkey = findPrimaryKey(headers);
      if (pkey !== undefined) {
        pkeyName.value = pkey.name;
      }
      writeTick.value = 0;
      loginDialog.show = true;
      sheetsDialog.show = false;
    } catch (err) {
      scriptError.value = err;
    }
  }
}

// 最後填寫者查詢對話框（LatestDialog）的進入點；目前列表頁按鈕停用中，保留供還原
function viewLatest() {
  latestDialogRef.value.open();
}
defineExpose({ viewLatest });

function viewStat() {
  statDialogRef.value.open();
}

// ===== 驗證與流程控制 =====
// 送出鈕的 disable 故意只看已寫入的 status、不對 value 做即時驗證：
// el-input 系的 change 要 blur/Enter 才觸發、檔案上傳與郵遞區號的值是程式塞入不走 change，
// Element Plus 給不了可靠的即時驗證時機。所以流程是「按一次送出→authMod 預檢全標紅
// →自動捲到第一個錯→按鈕才 disable」，不要改成對 value 即時檢測。
function checkData() {
  let ignoreCDB = _.filter(columnDB.value, (column) => {
    return !/C|G/.test(column.type);
  });
  return checkStatus(ignoreCDB, true);
}

function checkAuth() {
  return checkStatus(authDB.value, false);
}

function checkStatus(DB, allowEmpty) {
  let proceed = true;
  if (!allowEmpty) {
    let valueMap = _.map(DB, 'value');
    proceed = _.every(valueMap, (value) => {
      return value !== '';
    });
  }
  if (proceed) {
    let statusMap = _.map(DB, 'status');
    return _.some(statusMap, (status) => {
      return status !== '';
    });
  }
  return true;
}

function reverseBody() {
  confirmDialog.show = false;
  signatureDialog.show = false;
  columnDialog.show = true;
}

async function authMod() {
  if (submitChecking.value) {
    return;
  }
  let ignoreCDB = _.filter(columnDB.value, (column) => {
    return !/C|G/.test(column.type);
  });
  for (let i = 0; i < ignoreCDB.length; i++) {
    valField(ignoreCDB[i]);
  }
  if (!checkData()) {
    if (allSignNames.value.length === 0) {
      columnDialog.show = false;
      confirmDialog.show = true;
    } else {
      enableSignature.value = true;
      emptySignatures.value = [];
      // 有啟用線上暫存才有邀請功能：進簽名步驟前先抓各格邀請狀態，
      // 已邀請的格不建 canvas（rebuildSignatureUI 只放未邀請的格）。
      // RPC 要在填寫 drawer 還開著時等完（按鈕轉 loading）——先關 drawer 再等，
      // 使用者會盯著兩個 drawer 都關閉的空白畫面好幾秒
      if (draftEnabled.value && !viewOnly.value) {
        submitChecking.value = true;
        const endLoading = beginLoading('查詢簽名邀請狀態中');
        try {
          await refreshInvites();
        } finally {
          submitChecking.value = false;
          endLoading();
        }
      }
      columnDialog.show = false;
      rebuildSignatureUI(false);
      signatureDialog.show = true;
      nextTick(() => {
        if (signatures.length > 0) {
          initSignaturePads();
        }
      });
    }
  } else {
    // ignoreCDB 從 columnDB 過濾而來，順序即畫面順序，第一個 status 非空的就是最上方的錯誤欄位
    let errorColumns = _.filter(ignoreCDB, (column) => {
      return column.status !== '';
    });
    ElMessage.error(
      '你有' + errorColumns.length + '個欄位格式有誤，自動滑到第一個錯誤的欄位，請仔細檢查'
    );
    if (errorColumns.length > 0) {
      let target = document.getElementById('formfield-' + errorColumns[0].tid);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
}

function nextSignature() {
  switchToNextSignature(signaturePad.value);
}

// 依邀請狀態重建本機簽名板：只有「未邀請」的格用 canvas 親簽。
// 不動 useSignatures 內部——canvas 數量與 signatures.length 恆等，iPadOS 13 的時機處理不碰。
// reinit=true 時（邀請狀態變化）重跑 initSignaturePads，已畫的簽名會被清掉需重簽
function rebuildSignatureUI(reinit) {
  let localNames = _.filter(allSignNames.value, (name) => {
    return inviteStateFor(name).status === 'none';
  });
  resetSignatures();
  addSignatures(localNames);
  if (reinit && signatureDialog.show && localNames.length > 0) {
    nextTick(() => {
      initSignaturePads();
    });
  }
}

// ===== 簽名邀請的格別操作 =====
async function inviteSlot(signName) {
  let email;
  try {
    const answer = await drawerPrompt(
      '受邀者會收到含邀請碼的 Email（信裡不附網址，請自行把本表單網址告知對方）。' +
        '發出後這一格改由對方簽，你要等對方簽完才能送出；且會重建簽名板，其他已畫的簽名需重簽。',
      '邀請他人遠端簽「' + signName + '」',
      {
        confirmButtonText: '寄出邀請信',
        cancelButtonText: '取消',
        inputPlaceholder: '受邀者的 Email',
        inputPattern: /^\S+@\S+\.\S+$/,
        inputErrorMessage: 'Email 格式錯誤',
        size: '60%',
      }
    );
    email = answer.value;
  } catch {
    return; // 取消
  }
  const ok = await sendInviteRpc(signName, email.toString().trim());
  if (ok) {
    rebuildSignatureUI(true);
  }
}

async function resendSlot(signName) {
  // 同 email 重發：換新 token、舊邀請碼立即失效。pending 格直接重發；
  // signed 格（簽名有問題請對方重簽）會在 useInvites 內二段確認後作廢舊簽名。
  // 兩種來源狀態都不在本機 canvas 清單裡，簽名板不用重建
  await sendInviteRpc(signName, inviteStateFor(signName).email);
}

async function changeSlotEmail(signName) {
  let email;
  try {
    const answer = await drawerPrompt(
      '輸入新的受邀者 Email；舊的邀請碼會立即失效',
      '更換「' + signName + '」的簽名者',
      {
        confirmButtonText: '寄出新邀請信',
        cancelButtonText: '取消',
        inputPlaceholder: '新受邀者的 Email',
        inputPattern: /^\S+@\S+\.\S+$/,
        inputErrorMessage: 'Email 格式錯誤',
      }
    );
    email = answer.value;
  } catch {
    return;
  }
  await sendInviteRpc(signName, email.toString().trim());
}

// 撤回授權，在這個裝置簽名（簽好的簽名要撤會有二段確認，在 useInvites 內）
async function revokeSlot(signName) {
  const ok = await revokeInviteRpc(signName);
  if (ok) {
    rebuildSignatureUI(true);
  }
}

// 邀請卡 header「更多 ▾」dropdown 的 command 分發（pending/expired 才有此 dropdown，
// 主行動「重發授權信」已攤平成獨立按鈕，這裡只處理次要的換 email／撤回）
function onInviteCommand(command, signName) {
  if (command === 'change') {
    changeSlotEmail(signName);
  } else if (command === 'revoke') {
    revokeSlot(signName);
  }
}

async function refreshInviteStates() {
  await refreshInvites();
  rebuildSignatureUI(true);
}

function endSignature() {
  if (pendingInviteNames.value.length > 0) {
    ElMessage.error(
      '「' +
        pendingInviteNames.value.join('、') +
        '」還在等待受邀者簽名，等對方簽完（按「重新整理邀請狀態」確認）或撤回授權改在本機簽，才能繼續送出'
    );
    return;
  }
  if (signatures.length === 0) {
    // 全部簽名格都已由受邀者遠端完成
    confirmDialog.show = true;
    return;
  }
  emptySignatures.value = findEmptySignatures();
  if (emptySignatures.value.length === 0) {
    confirmDialog.show = true;
  }
}

function endView() {
  authToken.value = '';
  for (let i = 0; i < authDB.value.length; i++) {
    authDB.value[i].value = '';
    authDB.value[i].status = '';
  }
  columnDialog.show = false;
  loginDialog.show = true;
}

// ===== 後端互動 =====
async function queryPC(pColumn) {
  ElMessage('查詢郵遞區號中，請稍後');
  let pConfig = pColumn.content.split(';');
  let assocates = pConfig[1].split(',');
  let address = '';
  for (let i = 0; i < assocates.length; i++) {
    let aColumn = _.filter(columnDB.value, (column) => {
      return column.id === assocates[i];
    });
    if (aColumn.length > 0) {
      address += aColumn[0].value;
    }
  }
  try {
    const pStr = await gasRun('queryPC', address);
    scriptError.value.message = '';
    if (pStr !== '') {
      let postCode = JSON.parse(pStr);
      if (postCode !== undefined && postCode.zipcode !== undefined && postCode.zipcode !== '') {
        if (parseInt(pConfig[0]) === 6) {
          pColumn.value = postCode.zipcode6;
        } else {
          pColumn.value = postCode.zipcode.substring(0, parseInt(pConfig[0]));
        }
        pColumn.status = '';
      } else {
        pColumn.value = '';
        pColumn.status =
          '找不到你提供的地址所屬的郵遞區號，請修正地址或者自己輸入（手動輸入後去點其他的欄位，本訊息即會消失）';
      }
    } else {
      pColumn.value = '';
      pColumn.status =
        '自動查詢郵遞區號服務異常或者是找不到你的地址，請自己上網查郵遞區號吧（手動輸入後去點其他的欄位，本訊息即會消失）';
    }
  } catch (err) {
    scriptError.value = err;
  }
}

async function loginGmail(column) {
  googleStatus.value = undefined;
  try {
    const googleAcc = await gasRun('getGoogleID');
    if (googleAcc !== '') {
      googleStatus.value = googleAcc;
      column.value = googleAcc;
      column.status = '';
      nextTick(() => {
        loginView();
      });
    } else {
      column.status =
        '你根本沒有登入Google帳號，或者是你不是用本單位發的Google帳號，可以開一個新分頁登入Google之後再回來這裡，重新整理網頁即可';
    }
  } catch (err) {
    loginStatus.value = false;
    googleStatus.value = undefined;
    scriptError.value = err;
  }
}

async function loginView() {
  if (!checkAuth()) {
    let sheet = _.filter(sheets.value, (item) => {
      return item.id === currentSID.value;
    });
    loginStatus.value = true;
    if (sheet.length > 0) {
      const endLoading = beginLoading('確認身分中');
      try {
        const sheetConfig = await gasRun(
          'readRecord',
          sheet[0].refer,
          sheet[0].record,
          plainClone(authDB.value)
        );
        scriptError.value.message = '';
        if (!sheetConfig) {
          scriptError.value.message = sheet[0].loginfailTip;
          loginStatus.value = false;
        } else {
          // 登入成功：改持有 token，清掉認證欄位值（身分證等個資不再駐留記憶體）。
          // 主鍵欄位值保留——它是 localStorage 暫存的 key，也本來就會存在瀏覽器
          authToken.value = sheetConfig.token || '';
          for (let i = 0; i < authDB.value.length; i++) {
            if (!/P/.test(authDB.value[i].type)) {
              authDB.value[i].value = '';
            }
          }
          let currentAns = { uid: currentUID.value, queue: [] };
          let primaryKey = findPrimaryKey(authDB.value);
          if (primaryKey !== undefined) {
            currentAns = loadOrCreateAns(primaryKey.value, currentUID.value);
          }
          remainEmail.value = sheetConfig.emailQuota;
          savedSignatures.value = sheetConfig.signatures;
          requestCount.value = sheetConfig.status;
          if (sheetConfig.status.lastTick !== '') {
            writeTick.value = sheetConfig.status.lastTick;
            lastSubmit.value = plainClone(
              _.filter(sheetConfig.headers, (data) => {
                return /F/.test(data.type);
              })
            );
            for (let i = 0; i < lastSubmit.value.length; i++) {
              lastSubmit.value[i].value = lastSubmit.value[i].lastInput;
            }
          }
          let columns = sheetConfig.headers;
          columnDB.value = _.filter(columns, (column) => {
            return /F|C|G/.test(column.type);
          });
          if (sheet[0].randomQ) {
            columnDB.value = _.shuffle(columnDB.value);
          } //亂數欄位
          prepareColumnsForDisplay(columnDB.value, currentAns.queue);
          loginDialog.show = false;
          loginStatus.value = false;
          googleStatus.value = undefined;
          columnDialog.show = true;
          // 檢查是否有有意義的暫存資料（值不為空且與原始值不同）
          if (currentAns.queue.length > 0) {
            tempFound.value = hasFilledData(currentAns.queue, columnDB.value);
          }
          sheetLoaded.value = true;
          // 線上暫存：問卷有啟用且非檢視模式時，查雲端有沒有暫存可還原
          draftEnabled.value = sheet[0].draftEnabled === true;
          if (draftEnabled.value && !viewOnly.value) {
            checkOnlineDraft(sheet[0]);
          }
        }
      } catch (err) {
        loginStatus.value = false;
        googleStatus.value = undefined;
        scriptError.value = err;
      } finally {
        endLoading();
      }
    }
  }
}

// token 逾時（倒數歸零或後端回 tokenExpired）：導回身分確認重新登入。
// 已填內容不動——columnDB 與 localStorage 暫存都在，重新登入後會自動載回
function handleTokenExpired() {
  authToken.value = '';
  columnDialog.show = false;
  signatureDialog.show = false;
  confirmDialog.show = false;
  fileDrawer.show = false;
  loginDialog.show = true;
  loginStatus.value = false;
  scriptError.value.message =
    '登入已逾時，請重新驗證身分。你已填的內容都還在，重新登入後會自動載回（簽名需重簽）';
}

// 點倒數條手動續約：拿仍有效的 token 跟後端換一顆新的（重新計時 1 小時）
async function renewAuthToken() {
  let sheet = currentSheet.value;
  if (sheet === null || authToken.value === '') {
    return false;
  }
  try {
    const result = await gasRun('renewToken', sheet.refer, sheet.record, authToken.value);
    if (result && result.renewed && result.token) {
      authToken.value = result.token;
      ElMessage.success('已延長登入時間 1 小時');
      return true;
    }
    if (result && result.tokenExpired) {
      handleTokenExpired();
      return false;
    }
    ElMessage.error(result && result.message ? result.message : '延長登入時間失敗');
    return false;
  } catch (err) {
    console.error('renewToken failed', err);
    ElMessage.error('延長登入時間失敗，請稍後再試');
    return false;
  }
}

async function sendMod() {
  if (!uploadingSheet.value) {
    uploadingSheet.value = true;
    emailObj.value = emailObj.enable ? emailObj.value : '';
    let currentSheet = _.filter(sheets.value, (sheet) => {
      return sheet.id === currentSID.value;
    });
    if (currentSheet.length > 0) {
      let signatureBlobs = collectSignatures();
      uploadStatus.value = true;
      const endLoading = beginLoading('資料上傳中');
      try {
        const report = await gasRun(
          'writeRecord',
          currentSheet[0].refer,
          currentSheet[0].record,
          authToken.value,
          plainClone(columnDB.value),
          enableModify.value,
          signatureBlobs,
          emailObj.value
        );
        uploadingSheet.value = false;
        if (report.tokenExpired) {
          uploadStatus.value = false;
          handleTokenExpired();
          return;
        }
        saveSuccessed.value = report.status;
        requestCount.value.pkey = '';
        scriptError.value.message = report.errorLog.length > 0 ? report.errorLog.join(',') : '';
        lastSubmit.value = _.filter(report.data, (data) => {
          return /F/.test(data.type);
        });
        columnDialog.show = false;
        confirmDialog.show = false;
        if (saveSuccessed.value) {
          let primaryKey = findPrimaryKey(authDB.value);
          if (primaryKey !== undefined) {
            clearSubmitted(primaryKey.value, currentUID.value);
          }
          // 純 append 模型（Phase 17）：雲端草稿永不刪除，送出後重新登入仍會跳暫存提示
          // （文案已註明「線上暫存不代表最終結果」），由使用者自行選擇忽略
          columnDB.value = [];
          authDB.value = [];
          authToken.value = '';
          enableModify.value = false;
        }
        writeTick.value = report.tick;
        loginDialog.show = true;
        nextTick(() => {
          uploadStatus.value = false;
        });
      } catch (err) {
        uploadingSheet.value = false;
        scriptError.value = err;
        uploadStatus.value = false;
      } finally {
        endLoading();
      }
    }
  }
}

function reloadPage() {
  gasRun('getScriptURL').then((url) => {
    window.open(url, '_top');
  });
}

// ===== 檔案上傳 =====
function uploadFile(column) {
  fileDrawer.column = column;
  fileDrawer.show = true;
}

// FileUploadDrawer 上傳成功後回寫 columnDB
function applyFileUpload({ columnId, fileID, fileURL }) {
  let column = _.filter(columnDB.value, (column) => {
    return column.id === columnId;
  });
  if (column.length > 0) {
    column[0].value = fileID;
    column[0].lastInput = fileURL;
    column[0].status = '';
  } else {
    ElMessage('無法對應檔案！');
  }
}

// ===== 受邀簽名者入口（邀請碼 + email OTP 二段驗證）=====
const INVALID_INVITE_MESSAGE =
  '這個邀請碼無效，或邀請已過期／被撤回。請聯絡填寫者重新發送邀請，或確認你完整複製了邀請碼';

function startInviteCooldown(seconds) {
  stopInviteCooldown();
  inviteResendCooldown.value = Math.max(0, Math.ceil(seconds));
  if (inviteResendCooldown.value === 0) {
    return;
  }
  inviteCooldownTimer = setInterval(() => {
    inviteResendCooldown.value -= 1;
    if (inviteResendCooldown.value <= 0) {
      stopInviteCooldown();
    }
  }, 1000);
}

function stopInviteCooldown() {
  if (inviteCooldownTimer !== null) {
    clearInterval(inviteCooldownTimer);
    inviteCooldownTimer = null;
  }
  inviteResendCooldown.value = 0;
}

// 邀請碼 → 寄一次性驗證碼。首次確認與「重寄驗證碼」共用；後端有 60 秒節流兜底，
// 剛寄過（例如 ?token= 直連後 reload）回 cooldownSeconds，沿用上一組驗證碼繼續倒數
async function sendInviteOtp(isResend) {
  const busy = isResend ? inviteResending : inviteChecking;
  if (busy.value || (isResend && inviteResendCooldown.value > 0)) {
    return;
  }
  const code = inviteCodeInput.value.toString().trim().toLowerCase();
  busy.value = true;
  try {
    const result = await gasRun('requestInviteOtp', code);
    if (!result) {
      inviteOtpStep.value = false;
      ElMessage.error(INVALID_INVITE_MESSAGE);
      return;
    }
    if (result.success) {
      inviteMaskedEmail.value = result.maskedEmail;
      inviteOtpStep.value = true;
      startInviteCooldown(60);
      if (isResend) {
        ElMessage.success('驗證碼已重寄');
      }
    } else if (typeof result.cooldownSeconds === 'number') {
      inviteMaskedEmail.value = result.maskedEmail || inviteMaskedEmail.value;
      inviteOtpStep.value = true;
      startInviteCooldown(result.cooldownSeconds);
    } else {
      inviteOtpStep.value = false;
      ElMessage.error(result.message || '驗證碼寄送失敗，請稍後再試');
    }
  } catch (err) {
    ElMessage.error(err && err.message ? err.message : '驗證碼寄送失敗，請稍後再試');
  } finally {
    busy.value = false;
  }
}

function confirmInviteCode() {
  const code = inviteCodeInput.value.toString().trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(code)) {
    ElMessage.error('邀請碼格式不對——應該是邀請信裡的一長串英數字，請完整複製後貼上');
    return;
  }
  sendInviteOtp(false);
}

async function verifyInviteOtp() {
  if (inviteVerifying.value) {
    return;
  }
  const code = inviteCodeInput.value.toString().trim().toLowerCase();
  const otp = inviteOtpInput.value.toString().trim();
  if (!/^\d{6}$/.test(otp)) {
    ElMessage.error('請輸入 6 位數驗證碼');
    return;
  }
  inviteVerifying.value = true;
  try {
    const result = await gasRun('inviteeLogin', code, otp);
    if (!result) {
      // 輸入 OTP 期間邀請被撤回/重發（競態走後端現行防線）：退回貼碼步驟
      inviteOtpStep.value = false;
      inviteOtpInput.value = '';
      stopInviteCooldown();
      ElMessage.error(INVALID_INVITE_MESSAGE);
      return;
    }
    if (result.otpFailed) {
      ElMessage.error(result.message || '驗證碼錯誤或已逾時，請重新輸入或按重寄');
      inviteOtpInput.value = '';
      invitePinRef.value?.clear();
      return;
    }
    // OTP 通過：關掉入口 drawer、開簽名畫面（內容已就緒）
    enteringInvitee = true;
    sheetsDialog.show = false;
    inviteCodeDialog.show = false;
    inviteeDialogRef.value.open(result);
  } catch (err) {
    ElMessage.error(err && err.message ? err.message : '載入簽名邀請失敗，請稍後再試');
  } finally {
    inviteVerifying.value = false;
  }
}

// 邀請碼 drawer 關閉（取消/ESC/點遮罩/驗證通過轉場）統一收尾；非轉場關閉才導回列表
// （?token= 直連進入時列表還沒載過，補載）
function handleInviteCodeClosed() {
  stopInviteCooldown();
  inviteOtpStep.value = false;
  inviteOtpInput.value = '';
  inviteCodeInput.value = '';
  if (enteringInvitee) {
    enteringInvitee = false;
    return;
  }
  if (sheets.value.length === 0) {
    loadSheet();
  } else {
    sheetsDialog.show = true;
  }
}

// 受邀者關閉簽名對話框：回問卷列表（邀請連結直接進入時列表還沒載過，補載）
function handleInviteeClosed() {
  if (sheets.value.length === 0) {
    loadSheet();
  } else {
    sheetsDialog.show = true;
  }
}

// ===== 初始化 =====
onMounted(() => {
  // 邀請連結（?token=xxx，由後端 doGet 驗證格式後注入）：跳過問卷列表直接進簽名模式
  const inviteToken =
    typeof window.__SM_INVITE_TOKEN__ === 'string' ? window.__SM_INVITE_TOKEN__ : '';
  // 問卷深連結（?sheet=xxx）：邀請 token 優先，深連結留給首次 loadSheet 消費
  pendingSheetRefer =
    typeof window.__SM_SHEET_REFER__ === 'string' ? window.__SM_SHEET_REFER__ : '';
  if (inviteToken !== '') {
    // 洗掉網址列的 ?token=（不論後續成敗）：裸邀請碼不留在瀏覽器歷史（共用電腦）。
    // GAS 沙盒 iframe 改不了上層網址，要走 google.script.history 專用 API；dev 模式無此物件
    try {
      if (typeof google !== 'undefined' && google.script && google.script.history) {
        google.script.history.replace(null, {}, null);
      }
    } catch (err) {
      console.error('history.replace failed', err);
    }
    // 直連與手動貼碼同一條路：邀請碼 drawer 自動填碼並寄 OTP（reload 濫發由後端節流擋）
    sheetsDialog.show = false;
    inviteCodeInput.value = inviteToken;
    inviteCodeDialog.show = true;
    nextTick(() => {
      confirmInviteCode();
    });
  } else {
    loadSheet();
  }
  setupOrientationListener();
  // Vue 已 mount、首屏內容（正常路徑：LoadingGame 已因 loadSheet 的 beginLoading 掛上）就緒後，
  // 淡出移除 index.html 的靜態載入罩幕，交叉溶接到真正的遊戲，減少空白等待感
  nextTick(() => {
    if (typeof window.hideInitialLoading === 'function') {
      window.hideInitialLoading();
    }
  });
});
</script>

<style scoped>
/* 填問卷/簽名確認 drawer 共用的固定 footer：主要動作（送出）靠後、次要動作靠前 */
.formFooter__hint {
  color: var(--el-color-danger);
  font-size: 0.95em;
  margin-bottom: 8px;
  text-align: center;
}

.formFooter__buttons {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.formFooter__buttons .el-button {
  flex: 1 1 auto;
  margin-left: 0;
}

/* 簽名邀請卡 header：左邊「誰的簽名」＋狀態 tag，右邊「管理邀請 ▾」dropdown */
.inviteCardHeader {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.inviteCardHeader__title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.inviteCardHeader__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.inviteCardHeader__actions .el-button + .el-button {
  margin-left: 0;
}

/* 手機直式：header 動作按鈕撐滿避免擠成一團 */
@media (max-width: 768px) {
  .inviteCardHeader__actions {
    width: 100%;
  }

  .inviteCardHeader__actions > * {
    flex: 1 1 auto;
  }

  .inviteCardHeader__actions :deep(.el-button) {
    width: 100%;
  }
}

</style>
