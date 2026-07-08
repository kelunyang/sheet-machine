<template>
  <JwtCountdownBar
    v-if="authToken !== ''"
    :remaining-time="remainingTime"
    :session-percentage="sessionPercentage"
    :renewing="renewing"
    @renew="handleRenewClick"
  />
  <el-dialog
    v-model="columnDialog.show"
    :fullscreen="columnDialog.fullscreen"
    :show-close="false"
    :title="'你正在' + viewTip + '問卷：' + currentQuery">
      <el-steps :active="stepIndicator" finish-status="finish" align-center>
        <el-step :title="step.title" v-for="(step, index) in availableSteps" :key="index" :status="step.status" />
      </el-steps>
      <el-space direction="vertical" fill wrap style="width: 100%">
        <el-alert title="請注意" type="warning" show-icon v-if="expired <= (10*60)">
          <template #default>
            <span style="font-size: 1.5em">
              問卷{{ expired > 0 ? "即將在" + expired + "秒後過期，屆時將無法送出！" : "已經無法填寫了" }}
            </span>
          </template>
        </el-alert>
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
        <el-row :gutter="10" v-if="enableModify" style="margin-top: 10px;">
          <el-col :span="draftEnabled ? 8 : 12">
            <el-button
              style="width: 100%"
              size="large"
              type="success"
              :disabled="!tempFound"
              @click="tempTransfer.openExport()">
              匯出暫存答案
            </el-button>
          </el-col>
          <el-col :span="draftEnabled ? 8 : 12">
            <el-button
              style="width: 100%"
              size="large"
              type="warning"
              @click="tempTransfer.openImport()">
              匯入暫存答案
            </el-button>
          </el-col>
          <el-col v-if="draftEnabled" :span="8">
            <el-button
              style="width: 100%"
              size="large"
              type="primary"
              :disabled="!tempFound"
              :loading="draftSaving"
              @click="saveDraftOnline()">
              線上暫存
            </el-button>
          </el-col>
        </el-row>
        <el-switch v-if="!viewOnly" class="ma1" size="large" active-text="我要修改問卷" v-model="enableModify"></el-switch>
        <FormField
          v-for="dataColumn in columnDB"
          :key="dataColumn.tid"
          :column="dataColumn"
          :column-db="columnDB"
          :enable-modify="enableModify"
          @query-pc="queryPC"
          @upload-file="uploadFile"
          @multi-select="multiSelect"
        />
        <el-button v-if="!viewOnly" class="ma1 pa2 xs12" size="large" type="danger" v-on:click="authMod()" :disabled="checkData()">
          {{ !checkData() ? "送出修改" : "請確認必填欄位都已填，並且不可以有格式錯誤（紅字）才可以送出喔！" }}
        </el-button>
        <el-button v-if="tempFound" class="ma1 pa2 xs12" size="large" type="primary" v-on:click="clearTemp()">清除未送出的暫存答案（會重新載入問卷）</el-button>
        <el-button v-else class="ma1 pa2 xs12" size="large" type="danger" v-on:click="endView()">
          檢視完畢
        </el-button>
        <el-button v-if="lastSubmit.length > 0" class="ma1 pa2 xs12" size="large" type="primary" v-on:click="downloadResult()">下載你上次填寫的結果</el-button>
      </el-space>
  </el-dialog>
  <el-dialog
    :show-close="false"
    v-model="sheetsDialog.show"
    :fullscreen="sheetsDialog.fullscreen"
    title="可供檢視／填答的表單">
    <ErrorAlert :message="scriptError.message" />
    <el-space direction="vertical" fill wrap style="width: 100%">
      <div class="xs12" style="font-size: 1em; color: #666; text-align: center;" v-if="sheets.length === 0">無資料</div>
      <el-table :data="sheets" stripe style="width: 100%" v-else>
        <el-table-column prop="dueDate" label="表單名稱" sortable>
          <template #default="scope">
            <el-tag
              v-for="tag in scope.row.tags"
              :key="tag.id"
              :color="tag.color.background"
              :style="{ margin: '1px', color: tag.color.text, borderColor: tag.color.background }"
              effect="dark"
            >
              {{ tag.name }}
            </el-tag>
            <span style="font-weight: bold">{{ scope.row.name }}</span><br/>
            <span v-if="scope.row.writeAllowed">填寫至：{{scope.row.dueDate === 0 ? "不開放" : dateConverter(scope.row.dueDate) }}</span><br/>
            <span v-if="scope.row.writeAllowed">檢視至：{{ dateConverter(scope.row.viewDate) }}</span>
            <span v-if="!scope.row.writeAllowed">本問卷暫時關閉</span>
          </template>
        </el-table-column>
        <el-table-column label="">
          <template #default="scope">
            <div class="buttonBlock">
            <el-button class="ma1 pa2" size="large" type="primary" v-on:click="openSheet(scope.row.id)" :disabled="!scope.row.writeAllowed">{{ viewCheck(scope.row) ? "檢視" : "填寫&檢視" }}表單</el-button>
            </div>
          </template>
        </el-table-column>
      </el-table>
      <el-divider>我有簽名的驗證碼（我只是簽名者之一）</el-divider>
      <el-input
        v-model="inviteCodeInput"
        size="large"
        placeholder="貼上邀請信中的驗證碼，即可檢視問卷並簽名"
        clearable
      >
        <template #append>
          <el-button v-on:click="openInviteeByCode()">進入簽名</el-button>
        </template>
      </el-input>
      <div class="footerText">Developer: <a class="cleanLink" href="mailto:kelunyang@outlook.com">Kelunyang</a>@LKSH 2023 <a style="color:#CCC" target="_blank" href="https://github.com/kelunyang/sheet-machine" >GITHUB</a></div>
    </el-space>
  </el-dialog>
  <el-dialog
    :show-close="false"
    v-model="signatureDialog.show"
    :fullscreen="signatureDialog.fullscreen"
    :title="'簽名確認（本表單共需' + allSignNames.length + '組簽名）'">
    <el-steps :active="stepIndicator" finish-status="finish" align-center>
      <el-step :title="step.title" v-for="(step, index) in availableSteps" :key="index" :status="step.status" />
    </el-steps>
    <el-alert title="簽名不得為空" type="error" show-icon v-if="emptySignatures.length > 0">
      <template #default>
        <span style="font-size: 1.5em">
          {{ emptySignatures.join("、") }}的簽名不得留空，否則無法繼續提交問卷！（你忘記按「簽下一個」？）
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
            <span style="font-weight: bold; font-size: 1.2em">「{{ name }}」的簽名</span>
            <el-tag
              style="margin-left: 8px"
              :type="inviteStateFor(name).status === 'signed' ? 'success' : inviteStateFor(name).status === 'expired' ? 'danger' : 'warning'">
              {{ inviteStateFor(name).status === 'signed' ? '已簽名' : inviteStateFor(name).status === 'expired' ? '邀請已過期' : '授權中' }}
            </el-tag>
          </template>
          <div v-if="inviteStateFor(name).status === 'signed'">
            <img :src="inviteStateFor(name).image" :alt="name + '的遠端簽名'" class="savedSignatureImg" />
            <div class="captionWord">已由受邀者（{{ inviteStateFor(name).email }}）遠端簽署完成</div>
            <el-button class="ma1" size="large" type="danger" :loading="inviteBusy" v-on:click="revokeSlot(name)">
              撤回這個簽名，在這個裝置重簽
            </el-button>
          </div>
          <div v-else>
            <div class="captionWord">
              已邀請 {{ inviteStateFor(name).email }}（{{ inviteStateFor(name).status === 'expired' ? '已於' : '有效至' }}{{ dateConverter(inviteStateFor(name).expireAt) }}{{ inviteStateFor(name).status === 'expired' ? '過期' : '' }}），等待對方簽名中；對方簽完之前你無法送出問卷
            </div>
            <el-button class="ma1" size="large" type="primary" :loading="inviteBusy" v-on:click="resendSlot(name)">重發授權信</el-button>
            <el-button class="ma1" size="large" type="warning" :loading="inviteBusy" v-on:click="changeSlotEmail(name)">更換簽名者Email</el-button>
            <el-button class="ma1" size="large" type="danger" :loading="inviteBusy" v-on:click="revokeSlot(name)">撤回授權，在這個裝置簽名</el-button>
          </div>
        </el-card>
      </template>
      <el-button v-if="hasInviteCards" class="ma1 pa1 xs12" size="large" type="info" :loading="inviteBusy" v-on:click="refreshInviteStates()">
        重新整理邀請狀態（受邀者簽完了嗎？）
      </el-button>
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
        <el-button v-if="signatures.length > 1" class="ma1 pa1 xs12" size="large" type="primary" v-on:click="nextSignature()">簽下一組（共{{ signatures.length }}組），到最後一個時會回到第一個</el-button>
        <el-button class="ma1 pa1 xs12" size="large" type="success" v-on:click="clearSignature()">清除{{ signatureTip }}的簽名</el-button>
        <el-button v-if="draftEnabled && !viewOnly" class="ma1 pa1 xs12" size="large" type="warning" :loading="inviteBusy" v-on:click="inviteSlot(signatureTip)">
          「{{ signatureTip }}」不在現場？用Email邀請他遠端簽名
        </el-button>
      </template>
      <el-alert v-else-if="pendingInviteNames.length === 0 && allSignNames.length > 0" title="全部簽名已完成" type="success" show-icon>
        <template #default>
          <span style="font-size: 1.5em">所有簽名格都已完成（含遠端簽名），請按下方按鈕繼續</span>
        </template>
      </el-alert>
      <el-button class="ma1 pa2 xs12" size="large" type="danger" v-on:click="endSignature()" :disabled="signatureSubmitStatus.isDisabled">{{ signatureSubmitStatus.message }}</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="reverseBody()">剛剛輸入的有誤，回去修改</el-button>
    </el-space>
  </el-dialog>
  <el-dialog
    :show-close="false"
    v-model="loginDialog.show"
    :fullscreen="loginDialog.fullscreen"
    :title="'確認身分以' + viewTip + '問卷：'+currentQuery">
    <el-steps :active="stepIndicator" finish-status="finish" align-center>
      <el-step :title="step.title" v-for="(step, index) in availableSteps" :key="index" :status="step.status" />
    </el-steps>
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
    <el-alert title="請注意" type="warning" show-icon v-if="expired <= (10*60)">
      <template #default>
        <span style="font-size: 1.5em">
          問卷{{ expired > 0 ? "即將在" + expired + "秒後過期，屆時將無法送出！" : "已經無法填寫了" }}
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
      <div class="footerText">Developer: <a class="cleanLink" href="mailto:kelunyang@outlook.com">Kelunyang</a>@LKSH 2023 <a style="color:#CCC" target="_blank" href="https://github.com/kelunyang/sheet-machine" >GITHUB</a></div>
    </el-space>
  </el-dialog>
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
    show-close="false"
    size="60%"
  >
    <el-steps :active="stepIndicator" finish-status="finish" align-center>
      <el-step :title="step.title" v-for="(step, index) in availableSteps" :key="index" :status="step.status" />
    </el-steps>
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
  <TempTransferDrawers
    ref="tempTransfer"
    :auth-db="authDB"
    :column-db="columnDB"
    :uid="currentUID"
    :sid="currentSID"
    :sheet-name="currentQuery"
    @imported="tempFound = true"
  />
  <LatestDialog ref="latestDialogRef" :sheet="currentSheet" :pkey-name="pkeyName" />
  <StatDialog ref="statDialogRef" :sheet="currentSheet" :sheet-name="currentQuery" />
  <InviteeSignDialog ref="inviteeDialogRef" @closed="handleInviteeClosed" />
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import _ from 'lodash';
import { getTagPalette } from './theme/colors.config.js';
import FormField from './components/FormField.vue';
import ErrorAlert from './components/ErrorAlert.vue';
import MultiSelectDrawer from './components/MultiSelectDrawer.vue';
import FileUploadDrawer from './components/FileUploadDrawer.vue';
import TempTransferDrawers from './components/TempTransferDrawers.vue';
import LatestDialog from './components/LatestDialog.vue';
import StatDialog from './components/StatDialog.vue';
import JwtCountdownBar from './components/JwtCountdownBar.vue';
import InviteeSignDialog from './components/InviteeSignDialog.vue';
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
import { useSteps } from './composables/useSteps';
import { useSignatures } from './composables/useSignatures';
import { useDraft } from './composables/useDraft';
import { useInvites } from './composables/useInvites';
import { useJwtSession } from './composables/useJwtSession';

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
const sheetsDialog = reactive({ show: true, fullscreen: true });
const loginDialog = reactive({ show: false, fullscreen: true });
const columnDialog = reactive({ show: false, fullscreen: true });
const signatureDialog = reactive({ show: false, fullscreen: true });
const confirmDialog = reactive({ show: false, fullscreen: true });
const multiDrawer = reactive({ show: false, column: null });
const fileDrawer = reactive({ show: false, column: null });

// template refs
const tempTransfer = ref(null); // TempTransferDrawers
const latestDialogRef = ref(null); // LatestDialog
const statDialogRef = ref(null); // StatDialog
const signaturePad = ref(null); // el-carousel
const inviteeDialogRef = ref(null); // InviteeSignDialog

// 受邀簽名者入口：首屏手動貼驗證碼（邀請信也提供 ?token= 連結直接進入）
const inviteCodeInput = ref('');

// ===== composables =====
const { stepIndicator, availableSteps, changeStep, viewStep } = useSteps();
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
  deleteDraftOnline,
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

function viewCheck(sheet) {
  let now = dayjs().valueOf();
  if (sheet.dueDate <= now) return true;
  return false;
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
  ElMessage('問卷列表載入中，請稍後');
  try {
    const list = await gasRun('getQList');
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
  } catch (err) {
    scriptError.value = err;
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
      if (expired.value <= 0) {
        viewStep('輸入資料', false);
        if (now < viewDate.value) {
          viewOnly.value = true;
          enableModify.value = false;
          viewStep('檢視資料', true);
          viewStep('最後確認', false);
        }
      } else {
        viewStep('輸入資料', true);
        viewStep('檢視資料', false);
        viewStep('最後確認', true);
      }
      if (signatures.length > 0) {
        viewStep('簽名確認', true);
      } else {
        viewStep('簽名確認', false);
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
      nextTick(() => {
        changeStep('身分確認', 'process', 'wait', 'wait');
      });
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
  nextTick(() => {
    changeStep('輸入資料', 'process', 'success', 'wait');
  });
}

async function authMod() {
  let ignoreCDB = _.filter(columnDB.value, (column) => {
    return !/C|G/.test(column.type);
  });
  for (let i = 0; i < ignoreCDB.length; i++) {
    valField(ignoreCDB[i]);
  }
  if (!checkData()) {
    columnDialog.show = false;
    if (allSignNames.value.length === 0) {
      confirmDialog.show = true;
      nextTick(() => {
        changeStep('最後確認', 'process', 'success', 'success');
      });
    } else {
      enableSignature.value = true;
      emptySignatures.value = [];
      // 有啟用線上暫存才有邀請功能：進簽名步驟前先抓各格邀請狀態，
      // 已邀請的格不建 canvas（rebuildSignatureUI 只放未邀請的格）
      if (draftEnabled.value && !viewOnly.value) {
        await refreshInvites();
      }
      rebuildSignatureUI(false);
      signatureDialog.show = true;
      nextTick(() => {
        if (signatures.length > 0) {
          initSignaturePads(() => {
            changeStep('簽名確認', 'process', 'success', 'wait');
          });
        } else {
          changeStep('簽名確認', 'process', 'success', 'wait');
        }
      });
    }
  } else {
    ElMessage('資料送出前預格式檢查失敗，請檢查每個欄位下的錯誤訊息');
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
    const answer = await ElMessageBox.prompt(
      '受邀者會收到含連結與驗證碼的 Email，可在自己的裝置檢視唯讀問卷並簽署「' +
        signName +
        '」。發出邀請後這一格就不能在本機簽，且要等對方簽完你才能送出問卷；' +
        '發出邀請會重建簽名板，其他格已畫的簽名需要重簽。',
      '邀請他人遠端簽「' + signName + '」',
      {
        confirmButtonText: '寄出邀請信',
        cancelButtonText: '取消',
        inputPlaceholder: '受邀者的 Email',
        inputPattern: /^\S+@\S+\.\S+$/,
        inputErrorMessage: 'Email 格式錯誤',
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
  // 同 email 重發：換新 token、舊連結立即失效；狀態仍是授權中，簽名板不用重建
  await sendInviteRpc(signName, inviteStateFor(signName).email);
}

async function changeSlotEmail(signName) {
  let email;
  try {
    const answer = await ElMessageBox.prompt(
      '輸入新的受邀者 Email；舊的邀請連結與驗證碼會立即失效',
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
    nextTick(() => {
      changeStep('簽名確認', 'error', 'success', 'wait');
    });
    return;
  }
  if (signatures.length === 0) {
    // 全部簽名格都已由受邀者遠端完成
    confirmDialog.show = true;
    nextTick(() => {
      changeStep('最後確認', 'process', 'success', 'wait');
    });
    return;
  }
  emptySignatures.value = findEmptySignatures();
  if (emptySignatures.value.length === 0) {
    confirmDialog.show = true;
    nextTick(() => {
      changeStep('最後確認', 'process', 'success', 'wait');
    });
  } else {
    nextTick(() => {
      changeStep('簽名確認', 'error', 'success', 'wait');
    });
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
  nextTick(() => {
    changeStep('身分確認', 'process', 'wait', 'wait');
  });
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
    nextTick(() => {
      changeStep('身分確認', 'error', 'wait', 'wait');
    });
  }
}

async function loginView() {
  if (!checkAuth()) {
    let sheet = _.filter(sheets.value, (item) => {
      return item.id === currentSID.value;
    });
    loginStatus.value = true;
    if (sheet.length > 0) {
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
          nextTick(() => {
            changeStep('身分確認', 'error', 'wait', 'wait');
          });
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
          nextTick(() => {
            if (viewOnly.value) {
              changeStep('檢視資料', 'process', 'success', 'wait');
            } else {
              changeStep('輸入資料', 'process', 'success', 'wait');
            }
          });
        }
      } catch (err) {
        loginStatus.value = false;
        googleStatus.value = undefined;
        scriptError.value = err;
        nextTick(() => {
          changeStep('身分確認', 'error', 'wait', 'wait');
        });
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
  nextTick(() => {
    changeStep('身分確認', 'error', 'wait', 'wait');
  });
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
          // 正式送出成功後清掉雲端暫存（失敗不阻斷流程）；要在 token 清空前呼叫
          deleteDraftOnline(currentSheet[0]);
          columnDB.value = [];
          authDB.value = [];
          authToken.value = '';
          enableModify.value = false;
        }
        writeTick.value = report.tick;
        loginDialog.show = true;
        nextTick(() => {
          uploadStatus.value = false;
          if (saveSuccessed.value) {
            changeStep('最後確認', 'success', 'success', 'success');
          } else {
            changeStep('最後確認', 'error', 'success', 'success');
          }
        });
      } catch (err) {
        uploadingSheet.value = false;
        scriptError.value = err;
        uploadStatus.value = false;
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

// ===== 受邀簽名者入口 =====
function openInviteeByCode() {
  let code = inviteCodeInput.value.toString().trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(code)) {
    ElMessage.error('驗證碼格式不對——應該是邀請信裡的一長串英數字，請完整複製後貼上');
    return;
  }
  sheetsDialog.show = false;
  inviteeDialogRef.value.open(code);
}

// 受邀者關閉簽名對話框：回問卷列表（邀請連結直接進入時列表還沒載過，補載）
function handleInviteeClosed() {
  inviteCodeInput.value = '';
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
  if (inviteToken !== '') {
    sheetsDialog.show = false;
    nextTick(() => {
      inviteeDialogRef.value.open(inviteToken);
    });
  } else {
    loadSheet();
  }
  setupOrientationListener();
});
</script>
