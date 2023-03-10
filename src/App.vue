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
              你填過了{{ requestCount.length }}次，最後一次是在{{ dateConverter(requestCount.lastTick) }}填的，系統會在下面顯示你上次填寫的結果，如果你沒有要更新可以不用一直來填寫，關閉視窗即可
            </span>
            <span style="font-size: 1.5em" v-if="requestCount.length === 0">
              你沒有填過
            </span>
          </template>
        </el-alert>
        <el-switch v-if="!viewOnly" class="ma1" size="large" active-text="我要修改問卷" v-model="enableModify"></el-switch>
        <el-space direction="vertical" fill wrap class="ma1 pa2 xs12 breakword" v-for="dataColumn in columnDB" :key="dataColumn.tid">
          <el-alert :title="dataColumn.name" type="info" show-icon v-if="formatDetector('M', 'C', dataColumn)">
            <template #default>
              <span style="font-size: 1.5em" v-html="HTMLConverter(dataColumn.content)"></span>
            </template>
          </el-alert>
          <div v-if="!/G/.test(dataColumn.type)" v-show="!formatDetector('M', 'C', dataColumn)" class="qTitle xs12">{{ dataColumn.name }}</div>
          <div v-if="!/G/.test(dataColumn.type)" v-show="!formatDetector('M', 'C', dataColumn)" class="xs12 breakword">
            <span class="oriTip">
              {{ formatDetector('F', 'C|F', dataColumn) ? "[系統原本儲存的檔案（點擊開啟新連結）🔎]" : formatDetector('S', 'C', dataColumn) ? "" : "[系統原本儲存的答案]" }}
            </span>
            <span v-if="formatDetector('F', 'F|C', dataColumn) || formatDetector('S', 'C', dataColumn)">
              <el-link v-if="formatDetector('F', 'C|F', dataColumn)" :href="dataColumn.savedContent" target="_blank">{{ dataColumn.savedContent }}</el-link>
              <span v-if="formatDetector('S', 'C', dataColumn)">{{ sumUp(dataColumn) }}</span>
            </span>
            <span v-else>
              {{ dataColumn.savedContent }}
            </span>
          </div>
          <div v-if="!/G/.test(dataColumn.type)" class="xs12 breakword" v-show="dataColumn.lastInput !== undefined">
            <span class="oriTip">
              {{ formatDetector('F', 'F', dataColumn) ? ( dataColumn.value === '' ? "[你上次提供的檔案（點擊開啟新連結）🔎]" : "[你剛剛上傳的檔案（點擊開啟新連結）🔎]" ) : "[你上次輸入的答案]" }}
            </span>
            <span v-if="formatDetector('F', 'F', dataColumn)">
              <el-link :href="dataColumn.lastInput" target="_blank">{{ dataColumn.lastInput }}</el-link>
            </span>
            <span v-else>{{ dataColumn.lastInput }}</span>
          </div>
          <el-input
            v-show="enableModify"
            v-if="formatDetector('M|N|T|E|P', 'F', dataColumn)"
            size="large"
            class="xs12"
            :label="dataColumn.name"
            v-model="dataColumn.value"
            v-on:change="valField(dataColumn)"
            outline>
          </el-input>
          <el-input
            v-show="enableModify"
            v-if="formatDetector('X', 'F', dataColumn)"
            size="large"
            class="xs12"
            :label="dataColumn.name"
            v-model="dataColumn.value"
            v-on:change="valField(dataColumn)"
            :autosize="{ minRows: dataColumn.content[2], maxRows: dataColumn.content[3] }"
            show-word-limit
            :maxlength="dataColumn.content[0]"
            :minlength="dataColumn.content[1]"
            type="textarea"
            outline>
          </el-input>
          <el-select
            v-show="enableModify"
            v-if="formatDetector('S', 'F', dataColumn)"
            v-model="dataColumn.value"
            class="xs12"
            :placeholder="dataColumn.name"
            v-on:change="valField(dataColumn)"
            size="large">
            <el-option
              v-for="item in dataColumn.content.split(';')"
              :key="item+dataColumn.tid+'key'"
              :label="item"
              :value="item"
            />
          </el-select>
          <el-slider
            v-show="enableModify"
            v-if="formatDetector('L', 'F', dataColumn)"
            v-model="dataColumn.value"
            v-on:change="valField(dataColumn)"
            size="large"
            input-size="large"
            :step="dataColumn.content[0]"
            :min="dataColumn.content[1]"
            :max="dataColumn.content[2]"
            show-input
            show-stops
          />
          <el-button v-show="enableModify" v-if="formatDetector('P', 'F', dataColumn)" class="ma1 pa2 xs12" size="large" type="success" v-on:click="queryPC(dataColumn)">
            按此自動填入郵遞區號（但你得自己確認對不對）
          </el-button>
          <el-button v-show="enableModify" v-if="formatDetector('F', 'F', dataColumn)" class="ma1 pa2 xs12" size="large" type="success" v-on:click="uploadFile(dataColumn)">點此上傳檔案{{ dataColumn.value !== "" ? "(已上傳)" : "(無上傳)" }}</el-button>
          <el-button v-show="enableModify" v-if="formatDetector('U', 'F', dataColumn)" class="ma1 pa2 xs12" size="large" type="success" v-on:click="multiSelect(dataColumn)">點此挑選你要的選項[{{ dataColumn.value !== "" ? "已選"+(dataColumn.value.split(';')).length : "無選擇" }}]</el-button>
          <div v-show="enableModify" class="captionWord" v-if="dataColumn.nullable">這個欄位可以留空</div>
          <div v-show="enableModify" class="captionWord" v-if="dataColumn.group !== ''">{{ groupTip(dataColumn) }}</div>
          <div v-show="enableModify" class="alertWord" v-if="dataColumn.status !== ''">{{ dataColumn.status }}</div>
          <div v-show="enableModify" class="captionWord" v-if="dataColumn.status === ''">{{ formatHelper(dataColumn) }}</div>
        </el-space>
        <el-button v-if="!viewOnly" class="ma1 pa2 xs12" size="large" type="danger" v-on:click="authMod()" :disabled="checkData()">
          {{ !checkData() ? "送出修改" : "你的格式有誤，請檢查" }}
        </el-button>
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
          <canvas class="signaturePad" :width="signatureWidth" :height="signatureHeight" />
        </el-carousel-item>
      </el-carousel>
      <el-button v-if="signatures.length > 1" class="ma1 pa1 xs12" size="large" type="primary" v-on:click="nextSignatrue()">簽下一組（共{{ signatures.length }}組），到最後一個時會回到第一個</el-button>
      <el-button class="ma1 pa1 xs12" size="large" type="success" v-on:click="clearSignature()">清除{{ signatureTip }}的簽名</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="danger" v-on:click="endSignature()">提交簽名，下一步！</el-button>
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
        <el-button v-if="formatDetector('G', 'P', authColumn)" class="ma1 pa2 xs12" size="large" type="danger" v-on:click="loginGmail(authColumn)">按此驗證你的Google帳號以進入表單</el-button>
        <div class="alertWord" v-if="authColumn.status !== ''">{{ authColumn.status }}</div>
        <div class="captionWord" v-if="authColumn.status === ''">{{ formatHelper(authColumn) }}</div>
      </el-space>
      <el-button v-if="authtypeCheck()" class="ma1 pa1 xs12" size="large" type="danger" :disabled="checkAuth()" v-on:click="loginView()">{{ checkAuth() ? "格式錯誤或有空值，修正後才可以送出" : "送出認證以" + viewTip + "表單" }}</el-button>
      <el-button v-if="saveSuccessed" class="ma1 pa2 xs12" size="large" type="success" v-on:click="downloadResult()">下載你剛剛填寫的結果</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="reloadPage()">回到問卷列表</el-button>
      <!-- <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="viewLatest()">查看最後一位填寫者以及你是否曾填寫過</el-button> -->
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="viewStat()">查看填答率統計 </el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="sendContact()" v-if="contactEmail !== ''">Email給問卷負責人</el-button>
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
      <el-button class="ma1 pa2 xs12" size="large" type="danger" v-on:click="startUpload()" :disabled="currentFile.fileList.length === 0">上傳檔案！</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="fileDialog.show = false">關閉對話框</el-button>
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
            請從 {{ currentMulti.selections.length }} 項中挑出至多 {{ currentMulti.maxNum }} 項，按下方藍色按鈕調整已選區的選項，如果要調整已選區的選項順序，勾選之後會出現調整功能（下方綠色按鈕）
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
  <!-- <el-dialog
    :show-close="false"
    v-model="confirmDialog.show"
    :fullscreen="confirmDialog.fullscreen"
    title="確定要送出了嗎？"> -->
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
      <!-- <el-space direction="vertical" fill wrap class="ma1 pa2 xs12" v-for="authColumn in authDB" :key="authColumn.tid">
        <div style="color: maroon" class="qTitle xs12" v-if="!/G/.test(authColumn.type)">{{ authColumn.name }}</div>
        <el-input
          v-if="formatDetector('I|N|T' ,'A|P', authColumn)"
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
        <div class="captionWord" v-if="authColumn.status !== ''">{{ authColumn.status }}</div>
      </el-space>
      <el-button class="ma1 pa2 xs12" size="large" type="danger" :disabled="checkAuth()" v-on:click="sendMod()">{{ checkAuth() ? "格式錯誤或有空值，修正後才可以送出" : "是的，我確定送出本次填寫的結果！" }}</el-button> -->
      <el-button class="ma1 pa2 xs12" size="large" type="danger" v-on:click="sendMod()" :disabled="checkSend()">{{ checkSend() ? "請修正你提供的Email格式，才能送出" : "是的，我確定送出本次填寫的結果！" }}</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="reverseBody()">剛剛輸入的有誤，回去修改</el-button>
    </el-space>
  <!-- </el-dialog> -->
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

<script>
  import { nextTick } from 'vue';
  import { ElMessage } from 'element-plus';
  import dayjs from 'dayjs';
  import { v4 as uuidv4 } from 'uuid';
  import _ from'lodash';
  import randomColor from 'randomcolor';
  import SmoothSignature from "smooth-signature";
  export default {
    methods: {
      rateSort: function(a, b) {
        return parseFloat(a.rate)-parseFloat(b.rate);
      },
      sendContact: function() {
        let element = document.createElement('a');
        element.setAttribute('href', "mailto:" + this.contactEmail);
        element.setAttribute('target', "_blank");
        element.click();
      },
      groupTip: function(column) {
        let tip = "";
        let helpWord = [];
        if(this.formatDetector('', 'F', column)) {
          if(column.group !== "") {
            let sameGroup = _.filter(this.columnDB, (col) => {
              return col.group === column.group;
            })
            helpWord.push("此欄位和" + sameGroup.length + "個欄位編組為「" + column.group + "」");
            helpWord.push("各欄位不得均為空");
            if(column.uniGroup) {
              helpWord.push("各欄位內容不可重複");
            }
            tip = _.join(helpWord, "，");
          }
        }
        return tip;
      },
      authtypeCheck: function() {
        if(this.authDB.length > 0) {
          let gmailFinder = _.filter(this.authDB, (column) => {
            if(/P/.test(column.type)) {
              return /G/.test(column.format);
            }
            return false;
          });
          return !gmailFinder.length > 0;
        }
        return false;
      },
      checkSend: function() {
        if(this.emailObj.enable) {
          if(this.emailObj.status === "") {
            return false;
          }
          return true;
        } else {
          return false;
        }
      },
      selectionChanged: function(currentItem, direction, key) {
        if(direction === "right") {
          if(this.currentMulti.selected.length > this.currentMulti.maxNum) {
            this.currentMulti.selected.splice(this.currentMulti.maxNum);
            ElMessage('最多只能選' + this.currentMulti.maxNum + '項，系統自動清除你多選的');
          }
        }
      },
      multiSelect: function(dataColumn) {
        if(this.formatDetector('U', 'F', dataColumn)) {
          let selections = [];
          let selectionConfig = dataColumn.content.split('::');
          let oriSelect = selectionConfig[1].split(';');
          for(let i=0; i<oriSelect.length; i++) {
            selections.push({
              key: oriSelect[i],
              label: oriSelect[i],
              disabled: false
            });
          }
          this.currentMulti.maxNum = parseInt(selectionConfig[0]);
          this.currentMulti.name = dataColumn.name;
          this.currentMulti.id = dataColumn.id;
          this.currentMulti.selections = selections;
          this.currentMulti.selected = [];
          this.currentMulti.modified = [];
          this.currentMulti.error = "";
          let selected = _.uniq(dataColumn.value.split(';'));
          for(let i=0; i<selected.length; i++) {
            let findObj = _.filter(selections, (item) => {
              return item.key === selected[i];
            });
            if(findObj.length > 0) {
              this.currentMulti.selected.push(selected[i]);
            }
          }
          this.multisDialog.show = true;
        }
      },
      chooseSelection: function(selected) {
        this.currentMulti.modified = selected;
        let validArr = [];
        for(let i=0; i<this.currentMulti.selected.length; i++) {
          let checkSelect = _.filter(this.currentMulti.selections, (selection) => {
            return selection.key === this.currentMulti.selected[i];
          })
          if(checkSelect.length > 0) {
            validArr.push(true);
          }
        }
        let confirmedArr = _.filter(validArr, (item) => {
          return item === false;
        });
        if(confirmedArr.length > 0) {
          this.currentMulti.error = "你為什麼可以選到選項裡沒有的值？"
        }
      },
      selectionMove: function(direction) {
        let currentIndex = -1;
        let foundIndexs = [];
        let oriobj = this;
        let newIndex = 0;
        if(direction === 0) {
          newIndex = 0;
        }
        for(let i=0; i<this.currentMulti.modified.length; i++) {
          let nowIndex = _.findIndex(this.currentMulti.selected, (item) => {
            return item === oriobj.currentMulti.modified[i];
          });
          if(nowIndex > -1) {
            foundIndexs.push(nowIndex);
          }
        }
        foundIndexs = foundIndexs.sort();
        if(direction === 2) {
          currentIndex = foundIndexs[0];
        } else {
          currentIndex = foundIndexs[foundIndexs.length - 1];
        }
        if(currentIndex !== -1) {
          let tempSelected = [...this.currentMulti.selected];
          this.currentMulti.selected.splice(0);
          for(let i=0; i<tempSelected.length; i++) {
            let selected = _.filter(foundIndexs, (item) => {
              return item === i;
            });
            if(selected.length === 0) {
              this.currentMulti.selected.push(tempSelected[i]);
            }
          }
          if(direction === 2) {
            newIndex = currentIndex - 1 > 0 ? currentIndex - 1 : 0;
          } else if(direction === 3) {
            newIndex = currentIndex + 1 > this.currentMulti.selected.length ? this.currentMulti.selected.length : currentIndex + 1;
          } else if(direction === 1) {
            newIndex = this.currentMulti.selected.length > 0 ? this.currentMulti.selected.length : 0;
          }
          for(let i=0; i<foundIndexs.length; i++) {
            this.currentMulti.selected.splice(newIndex, 0, tempSelected[foundIndexs[i]]);
            newIndex++;
          }
        }
      },
      HTMLConverter: function (msg) {
        msg = msg === null || msg == undefined ? '**test**' : msg;
        let converter = new showdown.Converter({
          openLinksInNewWindow: true,
          simplifiedAutoLink: true
        });
        return converter.makeHtml(msg);
        //return marked(msg);
        //return msg;
      },
      sumUp: function(column) {
        if(/C/.test(column.type)) {
          if(/S/.test(column.format)) {
            if(column.content !== "") {
              let columns = column.content.split(';');
              let sumValue = 0;
              for(let i=0; i<columns.length; i++) {
                if(columns[i] !== "") {
                  let columnConfig = columns[i].split(":");
                  let target = _.filter(this.columnDB, (col) => {
                    return col.id === columnConfig[0];
                  });
                  if(target.length > 0) {
                    let value = isNaN(parseInt(target[0].value)) ? 0 : parseInt(target[0].value);
                    sumValue += value * parseInt(columnConfig[1]);
                  }
                }
              }
              return columns.length + "個欄位總和為：" + sumValue;
            }
          }
        }
        return "";
      },
      formatHelper: function(column) {
        if(this.formatDetector('', 'F|A|P', column)) {
          let tip = "";
          if(this.formatDetector('N', 'F|A|P', column)) {
            tip = "數字";
            if(column.content === "0") {
              tip += "，必須以0開頭，長度不限";
            } else {
              tip += "，長度為" + column.content;
            }
          } else if(this.formatDetector('X', 'F', column)) {
            if(column.content[0] !== '') {
              column.content[1] = '';
              tip = "最長允許" + column.content[0] + "字";
            }
            if(column.content[1] !== '') {
              tip = "至少要有" + column.content[1] + "字";
            }
          } else if(this.formatDetector('P', 'F|A|P', column)) {
            let pConfig = column.content.split(";");
            tip = pConfig[0] + "碼郵遞區號";
          } else if(this.formatDetector('I', 'F|A|P', column)) {
            tip = "身份證字號（第一碼一定是英文）";
          } else if(this.formatDetector('M', 'F|A|P', column)) {
            tip = "台灣的手機號碼，一定是09開頭";
          } else if(this.formatDetector('L', 'F|A|P', column)) {
            tip = "請拖拉一個從" + column.content[1] + "到" + column.content[2] + "之間的整數，每次增減" + column.content[0];
          } else if(this.formatDetector('E', 'F|A|P', column)) {
            tip = "Email格式，如test@test.com";
          } else if(this.formatDetector('T', 'F|A|P', column)) {
            if(column.content === "") {
              tip = "文字";
            } else {
              let regexConfig = column.content.split("::");
              tip = regexConfig[0];
            }
          } else if(this.formatDetector('S', 'F|A|P', column)) {
            tip = "請從選單中選一個正確的值";
          } else if(this.formatDetector('F', 'F|A|P', column)) {
            if(column.content === "") {
              tip = "你只能選擇一個檔案"
            } else {
              let contentConfig = column.content.split(";");
              let filetip = [];
              if(contentConfig[0] !== "") {
                filetip.push(contentConfig[0] + "類型檔案");
              }
              if(contentConfig[2] !== "") {
                filetip.push("大小需小於" + contentConfig[2] + "MB");
              }
              filetip.push("你只能選擇一個檔案");
              tip = _.join(filetip, "，");
            }
          } else if(this.formatDetector('U', 'F|A|P', column)) {
            let selectionConfig = column.content.split("::");
            let selections = _.uniq(selectionConfig[1].split(';'));
            tip = "從" + selections.length +"個選項中挑出"+selectionConfig[0]+"個（按上方按鍵去選）";
          } else if(this.formatDetector('G', 'F|A|P', column)) {
            tip = "本欄無法手動輸入，系統會自動讀取你登入的Google帳號";
          }
          return "格式：" + tip + "[輸入後點其他區域會重新檢查本欄位格式]";
        }
        return "";
      },
      formatDetector: function(formatReg, typeReg, column) {
        if((new RegExp(typeReg)).test(column.type)) {
          if((new RegExp(formatReg)).test(column.format)) {
            return true;
          }
        }
        return false;
      },
      downloadResult: function() {
        let result = [];
        for(let i=0; i<this.lastSubmit.length; i++) {
          let data = this.lastSubmit[i];
          result.push({
            "欄位名稱": data.name,
            "你填寫的值": data.value
          });
        }
        this.downloadCSV(result, "你填寫的結果");
      },
      downloadCSV: function(arr, name) {
        let output = "\ufeff"+ Papa.unparse(arr) + "\r\n寫入資料庫時間," + this.dateConverter(this.writeTick) + "\r\n本資料產生時間," + dayjs().format('YYYY-MM-DD HH:mm:ss');
        let blob = new Blob([output], { type: 'text/csv' });
        let url = window.URL.createObjectURL(blob);
        let element = document.createElement('a');
        element.setAttribute('href', url);
        element.setAttribute('download', name);
        element.click();
      },
      loadSheet: function() {
        let oriobj = this;
        ElMessage('問卷列表載入中，請稍後');
        google.script.run.withSuccessHandler((list) => {
          oriobj.scriptError.message = "";
          for(let i=0; i<list.length; i++) {
            let tags = list[i].name.match(/\[[^\]]+\]/g);
            list[i].tags = [];
            if(tags !== null) {
              for(let k=0; k<tags.length; k++) {
                list[i].tags.push({
                  name: tags[k].replace(/\[|\]/g,""),
                  color: oriobj.colors[ (i*10 + k) % oriobj.colors.length ],
                  id: uuidv4()
                });
              }
            }
            list[i].name = (list[i].name.match(/(?:.(?!\S*\]))+/))[0].replace(/\]/,"")
            list[i].id = uuidv4();
          }
          oriobj.sheets = list;
          oriobj.saveSuccessed = undefined;
          oriobj.requestCount.pkey = "";
          oriobj.lastSubmit = [];
          oriobj.signatures = [];
          oriobj.currentSignature = 0;
          oriobj.sheetsDialog.show = true;
          nextTick(() => {
            google.script.url.getLocation(function(location) {
              if(location.hash !== "") {
                ElMessage("捕捉到你想直接打開ID為" + location.hash + "問卷，請勿點擊其他連結");
                let sheets = _.filter(oriobj.sheets, (item) => {
                  return item.externalID === location.hash;
                });
                if(sheets.length > 0) {
                  oriobj.openSheet(sheets[0].id);
                  ElMessage("問卷開啟中...");
                } else {
                  ElMessage("找不到你要開啟的問卷，你確定這張問卷還可以填寫嗎？");
                }
              }
            });
          });
        })
        .withFailureHandler((data) => {
          oriobj.scriptError = data;
        })
        .getQList();
      },
      reverseBody: function() {
        let oriobj = this;
        this.confirmDialog.show = false;
        this.signatureDialog.show = false;
        this.columnDialog.show = true;
        nextTick(() => {
          oriobj.changeStep("輸入資料", "process", "success", "wait");
        });
      },
      checkData: function() {
        let ignoreCDB = _.filter(this.columnDB, (column) => {
          return !/C|G/.test(column.type);
        })
        return this.checkStatus(ignoreCDB, true);
      },
      checkAuth: function() {
        return this.checkStatus(this.authDB, false);
      },
      checkStatus: function(DB, allowEmpty) {
        let proceed = true;
        if(!allowEmpty) {
          let valueMap = _.map(DB, 'value');
          proceed = _.every(valueMap, (value) => {
            return value !== ""
          });
        }
        if(proceed) {
          let statusMap = _.map(DB, 'status');
          return _.some(statusMap, (status) => {
            return status !== ""
          });
        }
        return true;
      },
      valField: function(column) {
        let passMust = true;
        let skipnull = false;
        column.status = "";
        if(column.value === "") {
          if(column.nullable) {
            skipnull = true;
          }
        }
        if(this.formatDetector('', 'F', column)) {
          if(column.must) { //先檢查是否為空
            if(column.value === "") {
              passMust = false;
              column.status = "這個欄位必需有值！";
            } else {
              column.status = "";
            }
          }
          if(column.status === "") {  //再檢查群組設定
            if(column.group !== "") {
              let sameGroup = _.filter(this.columnDB, (col) => {
                return col.group === column.group;
              })
              if(_.every(sameGroup, {value: ""})) {
                for(let i=0; i<sameGroup.length; i++) {
                  sameGroup[i].status = "群組「" + column.group + "」欄位值不得全為空！";
                }
              } else {
                for(let i=0; i<sameGroup.length; i++) {
                  sameGroup[i].status = "";
                }
              }
              if(column.uniGroup) {
                let uniqed = _.uniqBy(sameGroup, (item) => {
                  return item.value.toString().trim();
                });
                if(sameGroup.length !== uniqed.length) {
                  for(let i=0; i<sameGroup.length; i++) {
                    sameGroup[i].status = "群組「" + column.group + "」欄位值不得重複！";
                  }
                } else {
                  for(let i=0; i<sameGroup.length; i++) {
                    sameGroup[i].status = "";
                  }
                }
              }
            }
          }
        }
        if(column.status === "") {  //最後檢查格式
          if(passMust) {
            if(!skipnull) {
              if(this.formatDetector('N|P', 'F|A|P', column)) {
                let num = 0;
                if(this.formatDetector('P', 'F|A|P', column)) {
                  let pConfig = column.content.split(";");
                  num = parseInt(pConfig[0]);
                } else if(this.formatDetector('N', 'F|A|P', column)) {
                  if(column.content !== "") {
                    num = parseInt(column.content);
                  }
                }
                let zeroIndicator = num === 0 ? "0" : "";
                let numLength = num > 0 ? "{" + num + "}" : "*";
                if(new RegExp("^" + zeroIndicator + "\\d" + numLength + "$").test(column.value)) {
                  column.status = "";
                } else {
                  column.status = zeroIndicator ? "這裡應該要輸入0開頭的數字" : "這裡應該輸入長度為" +  num + "的數字";
                }
              } else if(this.formatDetector('X', 'F', column)) {
                let lenCheck = false;
                if(column.content[0] !== '') {
                  column.content[1] = '';
                  let maxLen = parseInt(column.content[0]);
                  if(column.value.length > maxLen) {
                    column.status = "你輸入的文字長度超過限制！（" + column.value.length + "/" + maxLen + "）";
                    lenCheck = true;
                  }
                }
                if(column.status === "") {
                  if(column.content[1] !== '') {
                    let minLen = parseInt(column.content[1]);
                    if(column.value.length < minLen) {
                      column.status = "你輸入的文字太少了！（" + column.value.length + "/" + minLen + "）";
                      lenCheck = true;
                    }
                  }
                }
                if(!lenCheck) {
                  column.status = "";
                }
              } else if(this.formatDetector('L', 'F|A|P', column)) {
                if(_.inRange(column.value, column.content[1], column.content[2]+0.1)) {
                  let diff = column.value - column.content[1];
                  if(diff % column.content[0] === 0) {
                    column.status = "";
                  } else {
                    column.status = "數字必須是介於" + column.content[1] + "和" + column.content[2] + "，每次增減" + column.content[0] + "的整數！"
                  }
                } else {
                  column.status = "數字必須是介於" + column.content[1] + "和" + column.content[2] + "，每次增減" + column.content[0] + "的整數！"
                }
              } else if(this.formatDetector('I', 'F|A|P', column)) {
                if(/^[A-Z][0-9|A-Z]\d{8}$/.test(column.value)) {
                  column.status = "";
                } else {
                  column.status = "這裡應該要輸入身分證號，如A123456789";
                }
              } else if(this.formatDetector('E', 'F|A|P', column)) {
                if(/^\w+((-\w+)|(\.\w+))*\@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(column.value)) {
                  column.status = "";
                } else {
                  column.status = "這裡應該輸入Email";
                }
              } else if(this.formatDetector('M', 'F|A|P', column)) {
                if(/^09\d{8}$/.test(column.value)) {
                  column.status = "";
                } else {
                  column.status = "這裡應該輸入電話號碼，如0912345678";
                }
              } else if(this.formatDetector('T', 'F|A|P', column)) {
                if(column.content !== "") {
                  let regexConfig = column.content.split("::");
                  if(new RegExp(regexConfig[1]).test(column.value)) {
                    column.value = column.value.replace(/台(北|中|南|灣)/,'臺$1');
                    column.status = "";
                  } else {
                    column.status = "必須要包含以下關鍵字「" + regexConfig[0] + "」";
                  }
                }
              } else if(this.formatDetector('S', 'F|A|P', column)) {
                if(new RegExp(column.value).test(column.content)) {
                  column.status = "";
                } else {
                  column.status = "你真的是用選單選出來的值嗎？";
                }
              }
            }
          }
        }
      },
      dateConverter: function(tick) {
        if(tick === "" || tick === undefined) {
          return "無"
        } else {
          let dayObj = dayjs(tick);
          return dayObj.format('YYYY-MM-DD HH:mm:ss')
        }
      },
      openSheet: function(sid) {
        let oriobj = this;
        let sheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === sid;
        });
        ElMessage('載入問卷中，請稍後');
        if(sheet.length > 0) {
          google.script.run
          .withSuccessHandler((headers) => {
            let now = dayjs().valueOf();
            oriobj.enableModify = sheet[0].enableModify;
            oriobj.scriptError.message = "";
            oriobj.currentSID = sheet[0].id;
            oriobj.currentDue = sheet[0].dueDate;
            oriobj.viewDate = sheet[0].viewDate;
            oriobj.currentQuery = sheet[0].name;
            oriobj.loginTip = sheet[0].loginTip;
            oriobj.alertWords = sheet[0].comment;
            oriobj.submitTip = sheet[0].submitTip;
            oriobj.writeAllowed = sheet[0].writeAllowed;
            oriobj.contactEmail = sheet[0].email;
            for(let i=0; i<sheet[0].signatures.length; i++) {
              oriobj.signatures.push({
                id: uuidv4(),
                name: sheet[0].signatures[i],
                canvas: null,
                smObject: null
              });
            }
            if(oriobj.expired <= 0) {
              oriobj.viewStep("輸入資料", false);
              if(now < oriobj.viewDate) {
                oriobj.viewOnly = true;
                oriobj.enableModify = false;
                oriobj.viewStep("檢視資料", true);
                oriobj.viewStep("最後確認", false);
              }
            } else {
              oriobj.viewStep("輸入資料", true);
              oriobj.viewStep("檢視資料", false);
              oriobj.viewStep("最後確認", true);
            }
            if(oriobj.signatures.length > 0) {
              oriobj.viewStep("簽名確認", true);
            } else {
              oriobj.viewStep("簽名確認", false);
            }
            for(let i=0;i<headers.length; i++) {
              headers[i].tid = uuidv4();
              headers[i].status = "";
            }
            if(sheet[0].writeAllowed) {
              oriobj.authDB = _.filter(headers, (header) => {
                return /A|P/.test(header.type);
              });
              let gmailFinder = _.filter(oriobj.authDB, (column) => {
                if(/P/.test(column.type)) {
                  return /G/.test(column.format);
                }
                return false;
              });
              if(gmailFinder.length > 0) {
                oriobj.authDB = [gmailFinder[0]];
              }
            }
            let pkey = _.filter(headers, (header) => {
              return /P/.test(header.type);
            });
            if(pkey.length > 0) {
              oriobj.pkeyName = pkey[0].name;
            }
            oriobj.writeTick = 0;
            oriobj.loginDialog.show = true;
            oriobj.sheetsDialog.show = false;
            nextTick(() => {
              oriobj.changeStep("身分確認", "process", "wait", "wait");
            });
          })
          .withFailureHandler((data) => {
            oriobj.scriptError = data;
          }).publicHeader(sheet[0].refer);
        }
      },
      viewLatest: function() {
        let oriobj = this;
        let sheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === oriobj.currentSID;
        });
        ElMessage('載入問卷最後存取資訊中，請稍後');
        if(sheet.length > 0) {
          google.script.run
          .withSuccessHandler((latest) => {
            oriobj.scriptError.message = "";
            latest.tick = parseInt(latest.tick);
            latest.modified = /true|TRUE/.test(latest.modified) ? true : false;
            oriobj.lastSender = latest;
            oriobj.latestDialog.show = true;
          })
          .withFailureHandler((data) => {
            oriobj.scriptError = data;
          }).latestSubmits(sheet[0].record);
        }
      },
      queryExist: function() {
        let oriobj = this;
        let sheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === oriobj.currentSID;
        });
        ElMessage('查詢指定用戶是否填寫過問卷中，請稍後');
        if(sheet.length > 0) {
          google.script.run
          .withSuccessHandler((requested) => {
            oriobj.scriptError.message = "";
            oriobj.requestedUser = "";
            requested.modified = /true|TRUE/.test(requested.modified) ? true : false;
            requested.lastTick = parseInt(requested.lastTick);
            oriobj.requestCount = requested;
          })
          .withFailureHandler((data) => {
            oriobj.scriptError = data;
          }).duplicateSubmits(sheet[0].record, this.requestedUser);
        }
      },
      viewStat: function() {
        let oriobj = this;
        let sheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === oriobj.currentSID;
        });
        ElMessage('載入統計列表中，請稍後');
        if(sheet.length > 0) {
          google.script.run
          .withSuccessHandler((statsObj) => {
            oriobj.scriptError.message = "";
            oriobj.stats = statsObj;
            oriobj.writeTick = dayjs().valueOf();
            oriobj.statDialog.show = true;
          })
          .withFailureHandler((data) => {
            oriobj.scriptError = data;
          }).compareSheets(sheet[0].refer, sheet[0].record);
        }
      },
      sendMod: function() {
        let oriobj = this;
        this.emailObj.value = this.emailObj.enable ? this.emailObj.value : "";
        let currentSheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === oriobj.currentSID;
        });
        if(currentSheet.length > 0) {
          let signatures = [];
          for(let i=0; i<this.signatures.length; i++) {
            signatures.push({
              blob: this.signatures[i].smObject.getPNG(),
              name: this.signatures[i].name
            });
          }
          this.uploadStatus = true;
          google.script.run
            .withSuccessHandler((report) => {
              oriobj.saveSuccessed = report.status;
              oriobj.requestCount.pkey = "";
              oriobj.scriptError.message = report.errorLog.length > 0 ? report.errorLog.join(',') : "";
              oriobj.lastSubmit = _.filter(report.data, (data) => {
                return /F/.test(data.type);
              });
              oriobj.columnDialog.show = false;
              oriobj.confirmDialog.show = false;
              if(oriobj.saveSuccessed) {
                oriobj.columnDB = [];
                oriobj.authDB = [];
                oriobj.enableModify = false;
              }
              oriobj.writeTick = report.tick;
              oriobj.loginDialog.show = true;
              nextTick(() => {
                oriobj.uploadStatus = false;
                if(oriobj.saveSuccessed) {
                  oriobj.changeStep("最後確認", "success", "success", "success");
                } else {
                  oriobj.changeStep("最後確認", "error", "success", "success");
                }
              });
            })
            .withFailureHandler((data) => {
              oriobj.scriptError = data;
              oriobj.uploadStatus = true;
            }).writeRecord(currentSheet[0].refer, currentSheet[0].record, this.authDB, this.columnDB, this.enableModify, signatures, this.emailObj.value);
        }
      },
      closeLatest: function() {
        this.requestCount.pkey = "";
        this.latestDialog.show = false;
      },
      closeStat: function() {
        this.stats = [];
        this.statDialog.show = false;
      },
      authMod: function() {
        let oriobj = this;
        /*for(let i=0; i<this.authDB.length; i++) {
          if(/P/.test(this.authDB[i].type)) {
            this.authDB[i].value = "";
          }
          this.authDB[i].status = "";
        }*/
        this.columnDialog.show = false;
        if(this.signatures.length === 0) {
          this.confirmDialog.show = true;
          nextTick(() => {
            oriobj.changeStep("最後確認", "process", "success", "success");
          });
        } else {
          this.enableSignature = true;
          this.emptySignatures = [];
          this.signatureDialog.show = true;
          nextTick(() => {
            ElMessage('簽名模組準備中，請等待準備完成後再簽名！');
            if(oriobj.resizeTimer !== undefined) {
              clearTimeout(oriobj.resizeTimer);
              oriobj.resizeTimer = undefined;
            }
            if(oriobj.clearTimer !== undefined) {
              clearTimeout(oriobj.clearTimer);
              oriobj.clearTimer = undefined;
            }
            oriobj.clearTimer = setTimeout(() => {
              oriobj.changeStep("簽名確認", "process", "success", "wait");
              let canvas = document.querySelector("canvas.signaturePad");
              oriobj.signatureWidth = canvas.parentElement.clientWidth;
              oriobj.signatureHeight = canvas.parentElement.clientHeight;
              ElMessage('簽名清除中...');
              oriobj.resizeTimer = setTimeout(() => {
                let canvas = document.querySelectorAll("canvas.signaturePad");
                for(let i=0; i<canvas.length; i++) {
                  oriobj.signatures[i].canvas = canvas[i];
                  oriobj.signatures[i].smObject = new SmoothSignature(canvas[i]);
                }
                ElMessage('簽名模組準備完成，請在灰框內簽名');
              }, 1000);
            }, 3000);
          });
        }
      },
      endView: function() {
        let oriobj = this;
        for(let i=0; i<this.authDB.length; i++) {
          this.authDB[i].value = "";
          this.authDB[i].status = "";
        }
        this.columnDialog.show = false;
        this.loginDialog.show = true;
        nextTick(() => {
          oriobj.changeStep("身分確認", "process", "wait", "wait");
        });
      },
      queryPC: function(pColumn) {
        let oriobj = this;
        ElMessage('查詢郵遞區號中，請稍後');
        let pConfig = pColumn.content.split(";");
        let assocates = pConfig[1].split(",");
        let address = "";
        for(let i=0; i<assocates.length; i++) {
          let aColumn = _.filter(this.columnDB, (column) => {
            return column.id === assocates[i];
          })
          if(aColumn.length > 0) {
            address += aColumn[0].value;
          }
        }
        google.script.run
        .withSuccessHandler((pStr) => {
          oriobj.scriptError.message = "";
          if(pStr !== "") {
            let postCode = JSON.parse(pStr);
            if(postCode !== undefined) {
              if(postCode.zipcode !== undefined) {
                if(postCode.zipcode !== "") {
                  if(parseInt(pConfig[0]) === 6) {
                    pColumn.value = postCode.zipcode6;
                  } else {
                    pColumn.value = postCode.zipcode.substring(0, parseInt(pConfig[0]));
                  }
                  pColumn.status = "";
                } else {
                  pColumn.value = "";
                  pColumn.status = "找不到你提供的地址所屬的郵遞區號，請修正地址或者自己輸入（手動輸入後去點其他的欄位，本訊息即會消失）";
                }
              } else {
                pColumn.value = "";
                pColumn.status = "找不到你提供的地址所屬的郵遞區號，請修正地址或者自己輸入（手動輸入後去點其他的欄位，本訊息即會消失）";
              }
            } else {
              pColumn.value = "";
              pColumn.status = "找不到你提供的地址所屬的郵遞區號，請修正地址或者自己輸入（手動輸入後去點其他的欄位，本訊息即會消失）";
            }
          } else {
            pColumn.value = "";
            pColumn.status = "自動查詢郵遞區號服務異常或者是找不到你的地址，請自己上網查郵遞區號吧（手動輸入後去點其他的欄位，本訊息即會消失）"
          }
        })
        .withFailureHandler((data) => {
          oriobj.scriptError = data;
        }).queryPC(address);
      },
      loginGmail: function(column) {
        let oriobj = this;
        oriobj.googleStatus = undefined;
        google.script.run
        .withSuccessHandler((googleAcc) => {
          if(googleAcc !== "") {
            oriobj.googleStatus = googleAcc;
            column.value = googleAcc;
            column.status = "";
            nextTick(() => {
              oriobj.loginView();
            });
          } else {
            column.status = "你根本沒有登入Google帳號，或者是你不是用本單位發的Google帳號，可以開一個新分頁登入Google之後再回來這裡，重新整理網頁即可";
          }
        })
        .withFailureHandler((data) => {
          oriobj.loginStatus = false;
          oriobj.googleStatus = undefined;
          oriobj.scriptError = data;
          nextTick(() => {
            oriobj.changeStep("身分確認", "error", "wait", "wait");
          });
        }).getGoogleID();
      },
      loginView: function() {
        if(!this.checkAuth()) {
          let oriobj = this;
          let sheet = _.filter(this.sheets, (sheet) => {
            return sheet.id === oriobj.currentSID;
          });
          this.loginStatus = true;
          if(sheet.length > 0) {
            google.script.run
            .withSuccessHandler((sheetConfig) => {
              oriobj.scriptError.message = "";
              if(!sheetConfig) {
                oriobj.scriptError.message = sheet[0].loginfailTip;
                nextTick(() => {
                  oriobj.changeStep("身分確認", "error", "wait", "wait");
                });
              } else {
                /*let pkeyColumns = _.filter(oriobj.authDB, (column) => {
                  return /P/.test(column.type);
                });
                if(pkeyColumns.length > 0) {
                  oriobj.loading = true;
                  google.script.run
                  .withSuccessHandler((requested) => {
                    oriobj.scriptError.message = "";
                    oriobj.loading = false;
                    oriobj.requestCount = requested;
                  })
                  .withFailureHandler((data) => {
                    oriobj.scriptError = data;
                    oriobj.loading = false;
                  }).duplicateSubmits(sheet[0].record, pkeyColumns[0].value);
                }*/
                oriobj.remainEmail = sheetConfig.emailQuota;
                oriobj.savedSignatures = sheetConfig.signatures;
                oriobj.requestCount = sheetConfig.status;
                if(sheetConfig.status.lastTick !== "") {
                  oriobj.writeTick = sheetConfig.status.lastTick;
                  oriobj.lastSubmit = JSON.parse(JSON.stringify(_.filter(sheetConfig.headers, (data) => {
                    return /F/.test(data.type);
                  })));
                  for(let i=0;i<oriobj.lastSubmit.length; i++) {
                    oriobj.lastSubmit[i].value = oriobj.lastSubmit[i].lastInput;
                  }
                }
                let columns = sheetConfig.headers;
                oriobj.columnDB = _.filter(columns, (column) => {
                  return /F|C|G/.test(column.type);
                });
                for(let i=0;i<oriobj.columnDB.length; i++) {
                  let fileDetect = false;
                  oriobj.columnDB[i].tid = uuidv4();
                  if(/F/.test(oriobj.columnDB[i].type)) {
                    if(oriobj.columnDB[i].group !== "") {
                      let groupConfig = oriobj.columnDB[i].group.split(':');
                      oriobj.columnDB[i].group = groupConfig[0];
                      oriobj.columnDB[i].uniGroup = false;
                      if(groupConfig.length > 1) {
                        oriobj.columnDB[i].uniGroup = groupConfig[1] === "U";
                      }
                    }
                    if(/F/.test(oriobj.columnDB[i].format)) {
                      if(oriobj.columnDB[i].must) {
                        oriobj.columnDB[i].status = "請至少選擇一個檔案";
                        fileDetect = true;
                      }
                    } else if(/U/.test(oriobj.columnDB[i].format)) {
                      let selectionConfig = oriobj.columnDB[i].content.split("::");
                      let selections = _.uniq(selectionConfig[1].split(';'));
                      let selected = _.uniq(oriobj.columnDB[i].value.split(';'));
                      let newSelected = [];
                      for(let k=0; k<selected.length; k++) {
                        let checkSelect = _.filter(selections, (selection) => {
                          return selection === selected[k];
                        });
                        if(checkSelect.length > 0) {
                          newSelected.push(checkSelect[0]);
                        }
                      }
                      oriobj.columnDB[i].value = _.join(newSelected, ";");
                    } else if(/L/.test(oriobj.columnDB[i].format)) {
                      let defaultConfig = [1, 10, 100];
                      let userConfig = oriobj.columnDB[i].content.split(';');
                      if(userConfig.length === 3) {
                        defaultConfig = _.map(userConfig, (str) => {
                          return parseInt(str);
                        });
                      }
                      oriobj.columnDB[i].value = parseInt(oriobj.columnDB[i].value);
                      oriobj.columnDB[i].content = defaultConfig;
                    } else if(/X/.test(oriobj.columnDB[i].format)) {
                      let defaultConfig = ["", "", 2, 4];
                      let userConfig = oriobj.columnDB[i].content.split(';');
                      for(let k=0; k<userConfig.length; k++) {
                        if(k === 0) {
                          if(userConfig[k] !== '') {
                            userConfig[1] = '';
                          }
                        }
                        if(userConfig[k] !== '') {
                          defaultConfig[k] = parseInt(userConfig[k]);
                        }
                      }
                      oriobj.columnDB[i].content = defaultConfig;
                    }
                  }
                  if(!fileDetect) {
                    oriobj.columnDB[i].status = "";
                  }
                }
                oriobj.loginDialog.show = false;
                oriobj.loginStatus = false;
                oriobj.googleStatus = undefined;
                oriobj.columnDialog.show = true;
                nextTick(() => {
                  if(oriobj.viewOnly) {
                    oriobj.changeStep("檢視資料", "process", "success", "wait");
                  } else {
                    oriobj.changeStep("輸入資料", "process", "success", "wait");
                  }
                });
              }
            })
            .withFailureHandler((data) => {
              oriobj.loginStatus = false;
              oriobj.googleStatus = undefined;
              oriobj.scriptError = data;
              nextTick(() => {
                oriobj.changeStep("身分確認", "error", "wait", "wait");
              });
            }).readRecord(sheet[0].refer, sheet[0].record, this.authDB);
          }
        }
      },
      changeStep: function(name, currentStatus, previousStatus, nextStatus) {
        for(let i=0; i< this.stepStatus.length; i++) {
          if(this.stepStatus[i].title === name) {
            this.stepStatus[i].status = currentStatus;
            this.stepIndicator = i;
          }
        }
        for(let i=0; i<this.stepStatus.length; i++) {
          if(i < this.stepIndicator) {
            this.stepStatus[i].status = previousStatus;
          }
          if(i > this.stepIndicator) {
            this.stepStatus[i].status = nextStatus;
          }
        }
      },
      viewStep: function(name, status) {
        let step = _.filter(this.stepStatus, (step) => {
          return step.title === name;
        });
        if(step.length > 0) {
          step[0].show = status;
        }
      },
      viewCheck: function(sheet) {
        let now = dayjs().valueOf();
        if(sheet.dueDate <= now) return true;
        return false;
      },
      clearSignature: function() {
        this.signatures[this.currentSignature].smObject.clear();
        ElMessage(this.signatureTip + '簽名已清除！');
      },
      changeSignature: function(index) {
        this.currentSignature = index;
      },
      nextSignatrue: function() {
        let newIndex = (this.currentSignature + 1) % this.signatures.length;
        this.$refs.signaturePad.setActiveItem(newIndex);
      },
      endSignature: function() {
        let oriobj = this;
        this.emptySignatures = [];
        for(let i=0; i<this.signatures.length; i++) {
          if(this.signatures[i].smObject.isEmpty()) {
            this.emptySignatures.push(this.signatures[i].name);
            break;
          }
        }
        if(this.emptySignatures.length === 0) {
          this.confirmDialog.show = true;
          nextTick(() => {
            oriobj.changeStep("最後確認", "process", "success", "wait");
          });
        } else {
          nextTick(() => {
            oriobj.changeStep("簽名確認", "error", "success", "wait");
          });
        }
      },
      reloadPage: function() {
        google.script.run
          .withSuccessHandler(function(url){
            window.open(url,'_top');
          })
          .getScriptURL();
      },
      exceedLimit: function(file) {
        ElMessage('只能接受一個檔案！');
        this.currentFile.fileList = file;
      },
      uploadFile: function(column) {
        this.currentFile.id = column.id;
        this.currentFile.name = column.name;
        this.currentFile.maxSize = 1;
        this.currentFile.mimeType = "";
        this.currentFile.mimeAlt = "";
        if(column.content !== "") {
          let contentConfig = column.content.split(";");
          if(contentConfig[0] !== "") {
            this.currentFile.mimeAlt = contentConfig[0];
          }
          if(contentConfig[1] !== "") {
            this.currentFile.mimeType = contentConfig[1];
          }
          if(contentConfig[2] !== "") {
            this.currentFile.maxSize = parseInt(contentConfig[2]);
          }
        }
        this.currentFile.fileList = [];
        this.uploadErrors = "";
        this.fileDialog.show = true;
      },
      endSelection: function() {
        let oriobj = this;
        let column = _.filter(this.columnDB, (column) => {
          return column.id === oriobj.currentMulti.id;
        });
        if(column.length > 0) {
          column[0].value = _.join(this.currentMulti.selected, ";");
        }
        this.multisDialog.show = false;
      },
      startUpload: function() {
        let oriobj = this;
        let currentSheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === oriobj.currentSID;
        });
        this.uploadErrors = "";
        if(this.currentFile.fileList.length > 0) {
          let firstList = this.currentFile.fileList[0];
          let file = 'raw' in firstList ? firstList.raw : firstList;
          const fr = new FileReader();
          ElMessage("開始打包檔案上傳！");
          fr.onload = function(e) {
            const obj = {
              filename: file.name,
              mimeType: file.type,
              bytes: [...new Int8Array(e.target.result)],
            };
            if((new RegExp(oriobj.currentFile.mimeType, "i")).test(file.type)) {
              if(file.size <= oriobj.currentFile.maxSize * 1000000) {
                ElMessage("檔案上傳中！");
                oriobj.uploadStatus = true;
                google.script.run
                  .withSuccessHandler((report) => {
                    if(report.status) {
                      let column = _.filter(oriobj.columnDB, (column) => {
                        return column.id === oriobj.currentFile.id;
                      });
                      if(column.length > 0) {
                        column[0].value = report.fileID;
                        column[0].lastInput = report.fileURL;
                        column[0].status = "";
                        oriobj.uploadStatus = false;
                        oriobj.fileDialog.show = false;
                        ElMessage("上傳成功！");
                      } else {
                        oriobj.uploadErrors = "無法對應檔案！";
                        oriobj.uploadStatus = false;
                      }
                    } else {
                      oriobj.uploadErrors = _.join(report.errorLog, "、");
                      oriobj.uploadStatus = false;
                    }
                  })
                  .withFailureHandler((data) => {
                    oriobj.scriptError = data;
                    oriobj.uploadStatus = false;
                  })
                  .saveFile(currentSheet[0].refer, currentSheet[0].record, oriobj.authDB, oriobj.currentFile.id, obj);
              } else {
                oriobj.uploadErrors = "檔案超過大小限制！";
              }
            } else {
              oriobj.uploadErrors = "無法接受你的檔案格式！";
            }
          };
          fr.readAsArrayBuffer(file);
        }
      },
    },
    computed: {
      availableSteps: function() {
        return _.filter(this.stepStatus, (step) => {
          return step.show === true;
        });
      },
      viewTip: function() {
        return this.viewOnly ? "檢視" : "檢視&填寫";
      },
      expired: function() {
        let now = dayjs().valueOf();
        return ((this.currentDue - now) / 1000).toFixed(0);
      },
      signatureTip: function() {
        if(this.signatures.length > 0) {
          return this.signatures[this.currentSignature].name;
        }
        return "";
      },
      completeRate: function() {
        if(this.stats.length > 0) {
          return (_.meanBy(this.stats, (item) => {
            return parseInt(item.rate);
          })).toFixed(2);
        }
        return 0;
      }
    },
    mounted() {
      let oriobj = this;
      this.pageWidth = screen.width;
      this.colors = randomColor({
        count: 30,
        luminosity: 'dark',
        format: 'rgb'
      });
      this.loadSheet();
      window.addEventListener("deviceorientation", () => {
        if(oriobj.enableSignature) {
          if(oriobj.signatures.length > 0) {
            if(screen.width !== oriobj.pageWidth) {
              oriobj.pageWidth = screen.width;
              if(oriobj.resizeTimer !== undefined) {
                clearTimeout(oriobj.resizeTimer);
                oriobj.resizeTimer = undefined;
              }
              if(oriobj.clearTimer !== undefined) {
                clearTimeout(oriobj.clearTimer);
                oriobj.clearTimer = undefined;
              }
              ElMessage('簽名時偵測到視窗大小改變（手機旋轉？）！清除簽名中（避免破圖）');
              oriobj.clearTimer = setTimeout(() => {
                oriobj.signatureWidth = oriobj.signatures[0].canvas.parentElement.clientWidth;
                oriobj.signatureHeight = oriobj.signatures[0].canvas.parentElement.clientHeight;
                ElMessage('簽名清除中...');
                oriobj.resizeTimer = setTimeout(() => {
                  for(let i=0; i<oriobj.signatures.length; i++) {
                    oriobj.signatures[i].smObject.clear();
                    oriobj.signatures[i].smObject = new SmoothSignature(oriobj.signatures[i].canvas);
                  }
                  ElMessage('簽名模組調整完成，請在灰框內簽名');
                }, 1000);
              }, 3000);
            }
          }
        }
      }, true);
    },
    data() {
      return {
        contactEmail: "",
        writeAllowed: false,
        remainEmail: 0,
        progressColor: [
          { color: '#F56C6C', percentage: 20 },
          { color: '#FF9900', percentage: 40 },
          { color: '#E6A23C', percentage: 60 },
          { color: '#CCCC00', percentage: 80 },
          { color: '#67C23A', percentage: 100 },
        ],
        loginStatus: false,
        pageWidth: 0,
        currentFile: {
          name: "",
          mimeAlt: "",
          mimeType: "",
          maxSize: 1,
          id: "",
          fileList: []
        },
        uploadErrors: "",
        savedSignatures: [],
        uploadStatus: false,
        clearTimer: undefined,
        resizeTimer: undefined,
        emptySignatures: [],
        currentSignature: 0,
        enableSignature: false,
        signatureWidth: 100,
        signatureHeight: 100,
        viewOnly: false,
        viewDate: 0,
        colors: [],
        stepStatus: [
          {
            title: "身分確認",
            status: "wait",
            show: true
          },
          {
            title: "檢視資料",
            status: "wait",
            show: true
          },
          {
            title: "輸入資料",
            status: "wait",
            show: true
          },
          {
            title: "簽名確認",
            status: "wait",
            show: false
          },
          {
            title: "最後確認",
            status: "wait",
            show: true
          }
        ],
        signatures: [],
        currentDue: 0,
        stepIndicator: 0,
        writeTick: 0,
        lastSubmit: [],
        submitTip: "",
        pkeyName: "",
        requestedUser: "",
        loginTip: "",
        saveSuccessed: undefined,
        currentSID: "",
        scriptError: {
          message: ""
        },
        columnDB: [],
        authDB: [],
        enableModify: false,
        sheets: [],
        sheetsDialog: {
          show: true,
          transition: "slide-up",
          fullscreen: true
        },
        loginDialog: {
          show: false,
          transition: "slide-up",
          fullscreen: true
        },
        currentMulti: {
          id: "",
          name: "",
          selections: [],
          selected: [],
          maxNum: 0,
          modified: [],
          error: ""
        },
        multisDialog: {
          show: false,
          transition: "slide-down",
          fullscreen: true
        },
        fileDialog: {
          show: false,
          transition: "slide-down",
          fullscreen: true
        },
        signatureDialog: {
          show: false,
          transition: "slide-up",
          fullscreen: true
        },
        statDialog: {
          show: false,
          transition: "slide-up",
          fullscreen: true
        },
        columnDialog: {
          show: false,
          transition: "slide-up",
          fullscreen: true
        },
        confirmDialog: {
          show: false,
          transition: "slide-down",
          fullscreen: true
        },
        latestDialog: {
          show: false,
          transition: "slide-up",
          fullscreen: true
        },
        alertWords: "這份問卷涉及到你的大考報名地址，請謹慎填寫！",
        currentQuery: "",
        lastSender: {
          tick: 0,
          modified: true,
          pkey: ""
        },
        requestCount: {
          pkey: "",
          modified: false,
          length: 0,
          lastTick: 0
        },
        stats: [],
        emailObj: {
          value: "",
          nullable: false,
          type: "F",
          status: "請輸入一個Email",
          format: "E",
          enable: false
        }
      };
    },
  };
</script>