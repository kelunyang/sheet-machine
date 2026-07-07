<template>
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
        <el-alert title="發生錯誤" type="error" show-icon v-if="scriptError.message !== ''">
          <template #default>
            <span style="font-size: 1.5em">
              {{ scriptError.message }}
            </span>
          </template>
        </el-alert>
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
              @click="exportDrawer.show = true">
              匯出暫存答案
            </el-button>
          </el-col>
          <el-col :span="draftEnabled ? 8 : 12">
            <el-button
              style="width: 100%"
              size="large"
              type="warning"
              @click="triggerImportTemp()">
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
        <input type="file" ref="tempFileInput" accept=".smtemp" style="display:none" @change="onFileSelected" />
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
    <el-alert title="發生錯誤" type="error" show-icon v-if="scriptError.message !== ''">
      <template #default>
        <span style="font-size: 1.5em">
          {{ scriptError.message }}
        </span>
      </template>
    </el-alert>
    <el-space direction="vertical" fill wrap style="width: 100%">
      <div class="xs12" style="font-size: 1em; color: #666; text-align: center;" v-if="sheets.length === 0">無資料</div>
      <el-table :data="sheets" stripe style="width: 100%" v-else>
        <el-table-column prop="dueDate" label="表單名稱" sortable>
          <template #default="scope">
            <el-tag
              v-for="tag in scope.row.tags"
              :key="tag.id"
              :color="tag.color"
              style="margin:1px"
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
      <div class="footerText">Developer: <a class="cleanLink" href="mailto:kelunyang@outlook.com">Kelunyang</a>@LKSH 2023 <a style="color:#CCC" target="_blank" href="https://github.com/kelunyang/sheet-machine" >GITHUB</a></div>
    </el-space>
  </el-dialog>
  <el-dialog
    :show-close="false"
    v-model="signatureDialog.show"
    :fullscreen="signatureDialog.fullscreen"
    :title="'請提交'+signatures.length+'組簽名'">
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
          <el-link v-for="(sign, k) in savedSignatures" :key="'sign' + k" :href="sign" target="_blank">查看第{{ k + 1 }}個存檔簽名🔎</el-link>
        </span>
      </template>
    </el-alert>
    <el-alert :title="'你正在簽第' + (currentSignature + 1) + '組簽名，共' + signatures.length + '組'" type="warning" show-icon>
      <template #default>
        <span style="font-size: 1.5em">
          <span style="font-weight: bold;">請在灰框內簽下「 {{ signatureTip }}」的簽名（完成本表單共需要{{ signatures.length }}組簽名，這是第{{ currentSignature + 1 }}組）</span>，請注意，簽名需親簽（或得到授權），否則可能違反刑法217條偽造署押罪</span>
      </template>
    </el-alert>
    <el-space direction="vertical" :fill="true" wrap style="width: 100%">
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
    <el-alert title="發生錯誤" type="error" show-icon v-if="scriptError.message !== ''">
      <template #default>
        <span style="font-size: 1.5em">
          {{ scriptError.message }}
        </span>
      </template>
    </el-alert>
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
  <el-drawer
    v-model="fileDialog.show"
    title="你正在處理檔案欄位"
    direction="btt"
    show-close="false"
    size="90%"
  >
    <el-alert title="發生錯誤" type="error" show-icon v-if="scriptError.message !== ''">
      <template #default>
        <span style="font-size: 1.5em">
          {{ scriptError.message }}
        </span>
      </template>
    </el-alert>
    <el-alert title="發生錯誤" type="error" show-icon v-if="scriptError.message === ''" v-show="uploadErrors !== ''">
      <template #default>
        <span style="font-size: 1.5em">{{ uploadErrors }}</span>
      </template>
    </el-alert>
    <el-alert title="檔案限制" type="warning" show-icon v-if="scriptError.message === ''">
      <template #default>
        <span style="font-size: 1.5em">檔案類型：{{ currentFile.mimeAlt === "" ? "無限制" : currentFile.mimeAlt }}／檔案大小：{{ currentFile.maxSize }}MB／只能選擇1個檔案</span>
      </template>
    </el-alert>
    <el-alert title="上傳中" type="info" show-icon v-if="uploadStatus">
      <template #default>
        <span style="font-size: 1.5em">
          上傳可能會花上一段時間，在本訊息結束之前，請不要關閉視窗
        </span>
      </template>
    </el-alert>
    <div>欄位名稱：{{ currentFile.name }}</div>
    <el-space direction="vertical" fill wrap style="width: 100%">
      <el-upload
        :limit="1"
        :auto-upload="false"
        v-model:file-list="currentFile.fileList"
        :on-exceed="exceedLimit"
        class="ma1 pa2 xs12"
      >
        <template #trigger>
          <el-button type="primary">請選擇1個檔案</el-button>
        </template>
      </el-upload>
      <el-button class="ma1 pa2 xs12" size="large" type="danger" v-on:click="startUpload()" :disabled="currentFile.fileList.length === 0" v-if="!uploadStatus">上傳檔案！</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="fileDialog.show = false" v-if="!uploadStatus">關閉對話框</el-button>
    </el-space>
  </el-drawer>
  <el-drawer
    v-model="multisDialog.show"
    title="你正在處理多選欄位"
    direction="btt"
    show-close="false"
    size="90%"
  >
    <el-space direction="vertical" fill wrap style="width: 100%">
      <el-alert title="勾選數量限制" type="info" show-icon>
        <template #default>
          <span style="font-size: 1.5em">
            請從 {{ currentMulti.selections.length }} 項中 {{ currentMulti.maxNum > 0 ? "挑出至多" + currentMulti.maxNum + "項" : "挑出你要的項目（數量不限）" }}，按下方藍色按鈕調整已選區的選項，如果要調整已選區的選項順序，勾選之後會出現調整功能（下方綠色按鈕）
          </span>
        </template>
      </el-alert>
      <el-alert title="發生錯誤" type="error" show-icon v-if="currentMulti.error !== ''">
        <template #default>
          <span style="font-size: 1.5em">{{ currentMulti.error }}</span>
        </template>
      </el-alert>
      <div>欄位名稱：{{ currentMulti.name }}</div>
      <el-transfer
        class="ma1 pa2 xs12"
        v-model="currentMulti.selected"
        filterable
        :filter-method="filterMethod"
        filter-placeholder="在此可以打字搜尋"
        :data="currentMulti.selections"
        v-on:change="selectionChanged"
        v-on:right-check-change="chooseSelection"
        target-order="push"
        :titles="['候選名單', '已選名單']"
        :button-texts="['移出已選', '移入已選']"
      >
      </el-transfer>
      <el-space direction="horizonal" fill wrap class="ma1 pa2 xs12" v-if="currentMulti.modified.length > 0">
        <el-button class="ma1 pa2 xs12" size="large" type="success" @click="selectionMove(0)">將已選的{{ currentMulti.modified.length }}個選項置頂</el-button>
        <el-button class="ma1 pa2 xs12" size="large" type="success" @click="selectionMove(2)">將已選的{{ currentMulti.modified.length }}個選項向上一格</el-button>
        <el-button class="ma1 pa2 xs12" size="large" type="success" @click="selectionMove(3)">將已選的{{ currentMulti.modified.length }}個選項向下一格</el-button>
        <el-button class="ma1 pa2 xs12" size="large" type="success" @click="selectionMove(1)">將已選的{{ currentMulti.modified.length }}個選項置底</el-button>
      </el-space>
      <el-button class="ma1 pa2 xs12" size="large" type="danger" v-on:click="endSelection()">選擇完畢！</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="multisDialog.show = false">放棄選擇，回到上一頁</el-button>
    </el-space>
  </el-drawer>
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
    <el-alert title="發生錯誤" type="error" show-icon v-if="scriptError.message !== ''">
      <template #default>
        <span style="font-size: 1.5em">
          {{ scriptError.message }}
        </span>
      </template>
    </el-alert>
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
    v-model="exportDrawer.show"
    title="匯出暫存答案"
    direction="btt"
    size="100%">
    <el-alert title="注意事項" type="warning" show-icon>
      <template #default>
        <span style="font-size: 1.2em">
          匯出內容包含：文字、選單、已上傳的檔案連結。
          匯出的檔案經過 AES-256 加密，打開後會看到亂碼。
          解密需要使用「你的登入帳號 + 你現在輸入的密碼」組合的密碼。
        </span>
      </template>
    </el-alert>
    <el-space direction="vertical" fill wrap style="width: 100%; margin-top: 20px;">
      <div>請設定匯出密碼（匯入時需要輸入）：</div>
      <el-input
        v-model="exportDrawer.password"
        type="password"
        placeholder="請輸入密碼"
        show-password
        size="large" />
      <el-button
        size="large"
        type="primary"
        style="width: 100%"
        :disabled="exportDrawer.password.length === 0"
        @click="exportTemp()">
        確認匯出
      </el-button>
    </el-space>
  </el-drawer>
  <el-drawer
    v-model="importDrawer.show"
    title="匯入暫存答案"
    direction="btt"
    size="100%">
    <el-alert title="注意事項" type="info" show-icon>
      <template #default>
        <span style="font-size: 1.2em">
          匯入的檔案經過 AES-256 加密。
          解密需要使用「你的登入帳號 + 匯出時設定的密碼」組合的密碼。
          如果登入帳號不同或密碼錯誤，將無法解密。
        </span>
      </template>
    </el-alert>
    <el-space direction="vertical" fill wrap style="width: 100%; margin-top: 20px;">
      <div>已選擇檔案：{{ importDrawer.file?.name || '無' }}</div>
      <div>請輸入匯出時設定的密碼：</div>
      <el-input
        v-model="importDrawer.password"
        type="password"
        placeholder="請輸入密碼"
        show-password
        size="large" />
      <el-button
        size="large"
        type="primary"
        style="width: 100%"
        :disabled="importDrawer.password.length === 0"
        @click="importTemp()">
        確認匯入
      </el-button>
    </el-space>
  </el-drawer>
  <el-dialog
    :show-close="false"
    v-model="latestDialog.show"
    :fullscreen="latestDialog.fullscreen"
    title="最後一位填寫者以及你是否填過">
    <el-space direction="vertical" fill wrap style="width: 100%">
      <div class="qTitle">最後一位填寫者</div>
      <div>[{{ lastSender.modified ? "有修改" : "無修改" }}]{{ lastSender.pkey }}（{{ dateConverter(lastSender.tick) }}）</div>
      <div class="qTitle" v-if="pkeyName !== ''">查詢你填過沒有（請輸入{{ pkeyName }}）</div>
      <el-input
        v-if="pkeyName !== ''"
        size="large"
        class="xs12"
        :label="'輸入你想查詢的使用者的'+pkeyName"
        v-model="requestedUser"
        outline>
      </el-input>
      <div v-if="requestCount.pkey !== ''">[最後一次{{ requestCount.modified ? "有修改" : "無修改" }}]{{ requestCount.pkey }}（寫了{{ requestCount.length }}次，最後一次寫的時間是 {{ dateConverter(requestCount.lastTick) }} ）</div>
      <el-button class="ma1 pa2 xs12" size="large" type="danger" :disabled="requestedUser === ''" v-on:click="queryExist()">按此查詢是否填過</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="closeLatest()">關閉對話框</el-button>
    </el-space>
  </el-dialog>
  <el-dialog
    :show-close="false"
    v-model="statDialog.show"
    :fullscreen="statDialog.fullscreen"
    :title="currentQuery + '目前總填答率為：' + completeRate + '%'">
    <el-space direction="vertical" fill wrap style="width: 100%">
      <el-table :data="stats" stripe style="width: 100%" :border="true" :highlight-current-row="true">
        <el-table-column prop="classno" label="" min-width="10%"/>
        <el-table-column  prop="rate" label="填答率" sortable :sort-method="rateSort" min-width="20%">
          <template #default="scope">
            <el-progress :percentage="scope.row.rate" :color="progressColor" />
          </template>
        </el-table-column>
        <el-table-column prop="unfinished" label="未完成者" min-width="70%" resizable/>
      </el-table>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="downloadCSV(stats, currentQuery + '填寫率統計.csv')">匯出統計表</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="closeStat()">關閉對話框</el-button>
    </el-space>
  </el-dialog>
</template>

<script setup>
import { ref, reactive, computed, watch, onMounted, nextTick } from 'vue';
import { ElMessage } from 'element-plus';
import dayjs from 'dayjs';
import { v4 as uuidv4 } from 'uuid';
import _ from 'lodash';
import randomColor from 'randomcolor';
import FormField from './components/FormField.vue';
import { htmlConverter } from './utils/markdown';
import {
  formatDetector,
  formatHelper,
  findPrimaryKey,
  findGmailPrimary,
  validateColumn,
} from './utils/columnRules';
import {
  buildTempQueue,
  buildQueuePayload,
  hasFilledData,
  filterImportableQueue,
  applyQueueToColumns,
} from './utils/tempQueue';
import {
  getQueueAnswers,
  findAnsIndex,
  upsertQueue,
  replaceAns,
  clearQueue,
  clearSubmitted,
  loadOrCreateAns,
} from './utils/tempStorage';
import { encrypt, decrypt } from './composables/useCrypto';
import { gasRun, plainClone } from './composables/useGasRpc';
import { useSteps } from './composables/useSteps';
import { useSignatures } from './composables/useSignatures';
import { useDraft } from './composables/useDraft';

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
const requestedUser = ref('');
const loginStatus = ref(false);
const googleStatus = ref(undefined);
const saveSuccessed = ref(undefined);
const uploadingSheet = ref(false);
const uploadStatus = ref(false);
const uploadErrors = ref('');
const savedSignatures = ref([]);
const writeTick = ref(0);
const lastSubmit = ref([]);
const scriptError = ref({ message: '' });
const columnDB = ref([]);
const authDB = ref([]);
const enableModify = ref(false);
const sheets = ref([]);
const colors = ref([]);
const stats = ref([]);
const lastSender = ref({ tick: 0, modified: true, pkey: '' });
const requestCount = ref({ pkey: '', modified: false, length: 0, lastTick: 0 });

const progressColor = [
  { color: '#F56C6C', percentage: 20 },
  { color: '#FF9900', percentage: 40 },
  { color: '#E6A23C', percentage: 60 },
  { color: '#CCCC00', percentage: 80 },
  { color: '#67C23A', percentage: 100 },
];

const emailObj = reactive({
  value: '',
  nullable: false,
  type: 'F',
  status: '請輸入一個Email',
  format: 'E',
  enable: false,
});

const currentFile = reactive({
  name: '',
  mimeAlt: '',
  mimeType: '',
  maxSize: 1,
  id: '',
  fileList: [],
});

const currentMulti = reactive({
  id: '',
  name: '',
  selections: [],
  selected: [],
  maxNum: 0,
  modified: [],
  error: '',
});

// 對話框開關
const sheetsDialog = reactive({ show: true, fullscreen: true });
const loginDialog = reactive({ show: false, fullscreen: true });
const columnDialog = reactive({ show: false, fullscreen: true });
const signatureDialog = reactive({ show: false, fullscreen: true });
const confirmDialog = reactive({ show: false, fullscreen: true });
const multisDialog = reactive({ show: false, fullscreen: true });
const fileDialog = reactive({ show: false, fullscreen: true });
const statDialog = reactive({ show: false, fullscreen: true });
const latestDialog = reactive({ show: false, fullscreen: true });

// 匯出／匯入暫存檔
const exportDrawer = reactive({ show: false, password: '' });
const importDrawer = reactive({ show: false, password: '', file: null });

// template refs
const tempFileInput = ref(null);
const signaturePad = ref(null); // el-carousel

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
const { draftEnabled, draftSaving, saveDraftOnline, checkOnlineDraft, deleteDraftOnline } =
  useDraft({ sheets, currentSID, currentUID, authDB, columnDB, tempFound });

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

const expired = computed(() => {
  let now = dayjs().valueOf();
  return ((currentDue.value - now) / 1000).toFixed(0);
});

const completeRate = computed(() => {
  if (stats.value.length > 0) {
    return _.meanBy(stats.value, (item) => {
      return parseInt(item.rate);
    }).toFixed(2);
  }
  return 0;
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

// ===== 匯出／匯入暫存答案 =====
function triggerImportTemp() {
  tempFileInput.value.click();
}

function onFileSelected(event) {
  const file = event.target.files[0];
  if (file) {
    importDrawer.file = file;
    importDrawer.password = '';
    importDrawer.show = true;
  }
  event.target.value = '';
}

async function exportTemp() {
  let primaryKey = findPrimaryKey(authDB.value);
  if (primaryKey === undefined) {
    ElMessage.error('找不到主鍵欄位，無法匯出');
    return;
  }
  let queueAnswers = getQueueAnswers(primaryKey.value);
  let ansIndex = findAnsIndex(queueAnswers, currentUID.value);
  let currentAns = ansIndex > -1 ? queueAnswers[ansIndex] : undefined;
  if (!currentAns || currentAns.queue.length === 0) {
    ElMessage.error('沒有可以匯出的暫存資料');
    return;
  }
  // 組成匯出物件（與線上暫存同一格式）
  let exportData = buildQueuePayload(currentSID.value, currentAns.queue);
  try {
    // 加密金鑰 = 主鍵值 + 密碼
    const encryptPassword = primaryKey.value + exportDrawer.password;
    const encrypted = await encrypt(exportData, encryptPassword);
    // 下載檔案
    const blob = new Blob([encrypted], { type: 'application/octet-stream' });
    const url = window.URL.createObjectURL(blob);
    const element = document.createElement('a');
    element.setAttribute('href', url);
    element.setAttribute(
      'download',
      `問卷暫存_${currentQuery.value}_${dayjs().format('YYYYMMDD_HHmmss')}.smtemp`
    );
    element.click();
    window.URL.revokeObjectURL(url);
    exportDrawer.show = false;
    exportDrawer.password = '';
    ElMessage.success('暫存資料已匯出！請將檔案傳送到其他裝置後匯入');
  } catch (error) {
    ElMessage.error('匯出失敗：' + error.message);
  }
}

function importTemp() {
  if (!importDrawer.file) {
    ElMessage.error('請先選擇檔案');
    return;
  }
  let primaryKey = findPrimaryKey(authDB.value);
  if (primaryKey === undefined) {
    ElMessage.error('找不到主鍵欄位，無法匯入');
    return;
  }
  const reader = new FileReader();
  reader.onload = async function (e) {
    try {
      // 解密金鑰 = 當前主鍵值 + 密碼
      const decryptPassword = primaryKey.value + importDrawer.password;
      const importData = await decrypt(e.target.result, decryptPassword);
      // 驗證檔案格式
      if (!importData.version || !importData.data || !importData.data.queue) {
        ElMessage.error('匯入檔案格式不正確');
        return;
      }
      // 檢查 formId 是否相符
      if (importData.formId && importData.formId !== currentSID.value) {
        ElMessage.warning('注意：匯入的資料來自不同的問卷，部分欄位可能不相容');
      }
      // 過濾只匯入存在的欄位（包含檔案欄位）
      let importedQueue = filterImportableQueue(importData.data.queue, columnDB.value);
      let skippedCount = importData.data.queue.length - importedQueue.length;
      if (importedQueue.length === 0) {
        ElMessage.error('匯入失敗：沒有任何欄位可以匯入（欄位結構可能已變更）');
        return;
      }
      // 儲存到 localStorage 並直接更新 columnDB，讓畫面立即反應
      replaceAns(primaryKey.value, currentUID.value, importedQueue);
      applyQueueToColumns(importedQueue, columnDB.value);
      tempFound.value = true;
      // 顯示結果訊息
      let message = `成功匯入 ${importedQueue.length} 個欄位的暫存資料`;
      if (skippedCount > 0) {
        message += `，${skippedCount} 個欄位因不存在而略過`;
      }
      ElMessage.success(message);
      importDrawer.show = false;
      importDrawer.password = '';
      importDrawer.file = null;
    } catch {
      ElMessage.error('匯入失敗：密碼錯誤或身分不符');
    }
  };
  reader.onerror = function () {
    ElMessage.error('檔案讀取失敗');
  };
  reader.readAsText(importDrawer.file);
}

// ===== 一般工具 =====
function rateSort(a, b) {
  return parseFloat(a.rate) - parseFloat(b.rate);
}

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

function dateConverter(tick) {
  if (tick === '' || tick === undefined) {
    return '無';
  } else {
    let dayObj = dayjs(tick);
    return dayObj.format('YYYY-MM-DD HH:mm:ss');
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
    let selections = [];
    let selectionConfig = dataColumn.content.split('::');
    if (selectionConfig[0] === '') {
      selectionConfig[0] = 0;
    }
    let oriSelect = selectionConfig[1].split(';');
    for (let i = 0; i < oriSelect.length; i++) {
      selections.push({
        key: oriSelect[i],
        label: oriSelect[i],
        disabled: false,
      });
    }
    currentMulti.maxNum = parseInt(selectionConfig[0]);
    currentMulti.name = dataColumn.name;
    currentMulti.id = dataColumn.id;
    currentMulti.selections = selections;
    currentMulti.selected = [];
    currentMulti.modified = [];
    currentMulti.error = '';
    let selected = _.uniq(dataColumn.value.split(';'));
    for (let i = 0; i < selected.length; i++) {
      let findObj = _.filter(selections, (item) => {
        return item.key === selected[i];
      });
      if (findObj.length > 0) {
        currentMulti.selected.push(selected[i]);
      }
    }
    multisDialog.show = true;
  }
}

function filterMethod(query, item) {
  return item.label.includes(query);
}

function selectionChanged(currentItem, direction) {
  if (direction === 'right') {
    if (currentMulti.maxNum > 0) {
      if (currentMulti.selected.length > currentMulti.maxNum) {
        currentMulti.selected.splice(currentMulti.maxNum);
        ElMessage('最多只能選' + currentMulti.maxNum + '項，系統自動清除你多選的');
      }
    }
  } else {
    currentMulti.modified = [];
  }
}

function chooseSelection(selected) {
  currentMulti.modified = selected;
  let validArr = [];
  for (let i = 0; i < currentMulti.selected.length; i++) {
    let checkSelect = _.filter(currentMulti.selections, (selection) => {
      return selection.key === currentMulti.selected[i];
    });
    if (checkSelect.length > 0) {
      validArr.push(true);
    }
  }
  let confirmedArr = _.filter(validArr, (item) => {
    return item === false;
  });
  if (confirmedArr.length > 0) {
    currentMulti.error = '你為什麼可以選到選項裡沒有的值？';
  }
}

function selectionMove(direction) {
  let currentIndex = -1;
  let foundIndexs = [];
  let newIndex = 0;
  if (direction === 0) {
    newIndex = 0;
  }
  for (let i = 0; i < currentMulti.modified.length; i++) {
    let nowIndex = _.findIndex(currentMulti.selected, (item) => {
      return item === currentMulti.modified[i];
    });
    if (nowIndex > -1) {
      foundIndexs.push(nowIndex);
    }
  }
  foundIndexs = foundIndexs.sort();
  if (foundIndexs.length > 0) {
    if (direction === 2) {
      currentIndex = foundIndexs[0];
    } else {
      currentIndex = foundIndexs[foundIndexs.length - 1];
    }
  }
  if (currentIndex !== -1) {
    let tempSelected = [...currentMulti.selected];
    currentMulti.selected.splice(0);
    for (let i = 0; i < tempSelected.length; i++) {
      let selected = _.filter(foundIndexs, (item) => {
        return item === i;
      });
      if (selected.length === 0) {
        currentMulti.selected.push(tempSelected[i]);
      }
    }
    if (direction === 2) {
      newIndex = currentIndex - 1 > 0 ? currentIndex - 1 : 0;
    } else if (direction === 3) {
      newIndex =
        currentIndex + 1 > currentMulti.selected.length
          ? currentMulti.selected.length
          : currentIndex + 1;
    } else if (direction === 1) {
      newIndex = currentMulti.selected.length > 0 ? currentMulti.selected.length : 0;
    }
    for (let i = 0; i < foundIndexs.length; i++) {
      currentMulti.selected.splice(newIndex, 0, tempSelected[foundIndexs[i]]);
      newIndex++;
    }
  }
}

function endSelection() {
  let column = _.filter(columnDB.value, (column) => {
    return column.id === currentMulti.id;
  });
  if (column.length > 0) {
    column[0].value = _.join(currentMulti.selected, ';');
    valField(column[0]);
  }
  multisDialog.show = false;
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
  downloadCSV(result, '你填寫的結果');
}

function downloadCSV(arr, name) {
  let output =
    '﻿' +
    Papa.unparse(arr) +
    '\r\n寫入資料庫時間,' +
    dateConverter(writeTick.value) +
    '\r\n本資料產生時間,' +
    dayjs().format('YYYY-MM-DD HH:mm:ss');
  let blob = new Blob([output], { type: 'text/csv' });
  let url = window.URL.createObjectURL(blob);
  let element = document.createElement('a');
  element.setAttribute('href', url);
  element.setAttribute('download', name);
  element.click();
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
            color: colors.value[(i * 10 + k) % colors.value.length],
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

// 最後填寫者查詢對話框（latestDialog）的進入點；目前列表頁按鈕停用中，保留供還原
async function viewLatest() {
  let sheet = _.filter(sheets.value, (item) => {
    return item.id === currentSID.value;
  });
  ElMessage('載入問卷最後存取資訊中，請稍後');
  if (sheet.length > 0) {
    try {
      const latest = await gasRun('latestSubmits', sheet[0].record);
      scriptError.value.message = '';
      latest.tick = parseInt(latest.tick);
      latest.modified = /true|TRUE/.test(latest.modified) ? true : false;
      lastSender.value = latest;
      latestDialog.show = true;
    } catch (err) {
      scriptError.value = err;
    }
  }
}
defineExpose({ viewLatest });

async function queryExist() {
  let sheet = _.filter(sheets.value, (item) => {
    return item.id === currentSID.value;
  });
  ElMessage('查詢指定用戶是否填寫過問卷中，請稍後');
  if (sheet.length > 0) {
    try {
      const requested = await gasRun('duplicateSubmits', sheet[0].record, requestedUser.value);
      scriptError.value.message = '';
      requestedUser.value = '';
      requested.modified = /true|TRUE/.test(requested.modified) ? true : false;
      requested.lastTick = parseInt(requested.lastTick);
      requestCount.value = requested;
    } catch (err) {
      scriptError.value = err;
    }
  }
}

async function viewStat() {
  let sheet = _.filter(sheets.value, (item) => {
    return item.id === currentSID.value;
  });
  ElMessage('載入統計列表中，請稍後');
  if (sheet.length > 0) {
    try {
      const statsObj = await gasRun('compareSheets', sheet[0].refer, sheet[0].record);
      scriptError.value.message = '';
      stats.value = statsObj;
      writeTick.value = dayjs().valueOf();
      statDialog.show = true;
    } catch (err) {
      scriptError.value = err;
    }
  }
}

function closeLatest() {
  requestCount.value.pkey = '';
  latestDialog.show = false;
}

function closeStat() {
  stats.value = [];
  statDialog.show = false;
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

function authMod() {
  let ignoreCDB = _.filter(columnDB.value, (column) => {
    return !/C|G/.test(column.type);
  });
  for (let i = 0; i < ignoreCDB.length; i++) {
    valField(ignoreCDB[i]);
  }
  if (!checkData()) {
    columnDialog.show = false;
    if (signatures.length === 0) {
      confirmDialog.show = true;
      nextTick(() => {
        changeStep('最後確認', 'process', 'success', 'success');
      });
    } else {
      enableSignature.value = true;
      emptySignatures.value = [];
      signatureDialog.show = true;
      nextTick(() => {
        initSignaturePads(() => {
          changeStep('簽名確認', 'process', 'success', 'wait');
        });
      });
    }
  } else {
    ElMessage('資料送出前預格式檢查失敗，請檢查每個欄位下的錯誤訊息');
  }
}

function nextSignature() {
  switchToNextSignature(signaturePad.value);
}

function endSignature() {
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
          for (let i = 0; i < columnDB.value.length; i++) {
            let fileDetect = false;
            let column = columnDB.value[i];
            column.tid = uuidv4();
            if (/F/.test(column.type)) {
              if (column.group !== '') {
                let groupConfig = column.group.split(':');
                column.group = groupConfig[0];
                column.uniGroup = false;
                if (groupConfig.length > 1) {
                  column.uniGroup = groupConfig[1] === 'U';
                }
              }
              if (!/F/.test(column.format)) {
                let columnIndex = _.findIndex(currentAns.queue, (item) => {
                  return item.id === column.id;
                });
                if (columnIndex > -1) {
                  column.value = currentAns.queue[columnIndex].val;
                }
              }
              if (/F/.test(column.format)) {
                // 檔案欄位：從 localStorage 載入已上傳的檔案資訊
                let fileColumnIndex = _.findIndex(currentAns.queue, (item) => {
                  return item.id === column.id && item.isFile;
                });
                if (fileColumnIndex > -1) {
                  column.value = currentAns.queue[fileColumnIndex].val;
                  column.lastInput = currentAns.queue[fileColumnIndex].url;
                  column.status = '';
                } else if (column.must) {
                  column.status = '請至少選擇一個檔案';
                  fileDetect = true;
                }
              } else if (/U/.test(column.format)) {
                let selectionConfig = column.content.split('::');
                let selections = _.uniq(selectionConfig[1].split(';'));
                let selected = _.uniq(column.value.split(';'));
                let newSelected = [];
                for (let k = 0; k < selected.length; k++) {
                  let checkSelect = _.filter(selections, (selection) => {
                    return selection === selected[k];
                  });
                  if (checkSelect.length > 0) {
                    newSelected.push(checkSelect[0]);
                  }
                }
                column.value = _.join(newSelected, ';');
              } else if (/L/.test(column.format)) {
                let defaultConfig = [1, 10, 100];
                let userConfig = column.content.split(';');
                if (userConfig.length === 3) {
                  defaultConfig = _.map(userConfig, (str) => {
                    return parseInt(str);
                  });
                }
                column.value = parseInt(column.value);
                column.content = defaultConfig;
              } else if (/X/.test(column.format)) {
                let defaultConfig = ['', '', 2, 4];
                let userConfig = column.content.split(';');
                for (let k = 0; k < userConfig.length; k++) {
                  if (userConfig[k] !== '') {
                    defaultConfig[k] = parseInt(userConfig[k]);
                  }
                }
                column.content = defaultConfig;
              }
            }
            if (!fileDetect) {
              column.status = '';
            }
          }
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
          plainClone(authDB.value),
          plainClone(columnDB.value),
          enableModify.value,
          signatureBlobs,
          emailObj.value
        );
        uploadingSheet.value = false;
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
          // 正式送出成功後清掉雲端暫存（失敗不阻斷流程）；要在 authDB 清空前呼叫
          deleteDraftOnline(currentSheet[0]);
          columnDB.value = [];
          authDB.value = [];
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
function exceedLimit(file) {
  ElMessage('只能接受一個檔案！');
  currentFile.fileList = file;
}

function uploadFile(column) {
  currentFile.id = column.id;
  currentFile.name = column.name;
  currentFile.maxSize = 1;
  currentFile.mimeType = '';
  currentFile.mimeAlt = '';
  if (column.content !== '') {
    let contentConfig = column.content.split(';');
    if (contentConfig[0] !== '') {
      currentFile.mimeAlt = contentConfig[0];
    }
    if (contentConfig[1] !== '') {
      currentFile.mimeType = contentConfig[1];
    }
    if (contentConfig[2] !== '') {
      currentFile.maxSize = parseInt(contentConfig[2]);
    }
  }
  currentFile.fileList = [];
  uploadErrors.value = '';
  fileDialog.show = true;
}

function startUpload() {
  let currentSheet = _.filter(sheets.value, (sheet) => {
    return sheet.id === currentSID.value;
  });
  uploadErrors.value = '';
  if (currentFile.fileList.length > 0) {
    let firstList = currentFile.fileList[0];
    let file = 'raw' in firstList ? firstList.raw : firstList;
    const fr = new FileReader();
    ElMessage('檔案編碼中！');
    fr.onload = async function (e) {
      const obj = {
        filename: file.name,
        mimeType: file.type,
        bytes: [...new Int8Array(e.target.result)],
      };
      if (new RegExp(currentFile.mimeType, 'i').test(file.type)) {
        if (file.size <= currentFile.maxSize * 1000000) {
          ElMessage('檔案上傳中！');
          uploadStatus.value = true;
          try {
            const report = await gasRun(
              'saveFile',
              currentSheet[0].refer,
              currentSheet[0].record,
              plainClone(authDB.value),
              currentFile.id,
              obj
            );
            if (report.status) {
              let column = _.filter(columnDB.value, (column) => {
                return column.id === currentFile.id;
              });
              if (column.length > 0) {
                column[0].value = report.fileID;
                column[0].lastInput = report.fileURL;
                column[0].status = '';
                uploadStatus.value = false;
                fileDialog.show = false;
                ElMessage('上傳成功！');
              } else {
                uploadErrors.value = '無法對應檔案！';
                uploadStatus.value = false;
              }
            } else {
              uploadErrors.value = _.join(report.errorLog, '、');
              uploadStatus.value = false;
            }
          } catch (err) {
            scriptError.value = err;
            uploadStatus.value = false;
          }
        } else {
          uploadErrors.value = '檔案超過大小限制！';
        }
      } else {
        uploadErrors.value = '無法接受你的檔案格式！';
      }
    };
    fr.readAsArrayBuffer(file);
  }
}

// ===== 初始化 =====
onMounted(() => {
  colors.value = randomColor({
    count: 30,
    luminosity: 'dark',
    format: 'rgb',
  });
  loadSheet();
  setupOrientationListener();
});
</script>
