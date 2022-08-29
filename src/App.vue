<template>
  <el-dialog
    v-model="columnDialog.show"
    :fullscreen="columnDialog.fullscreen"
    :show-close="false"
    title="檢視／編輯表單">
      <el-space direction="vertical" fill wrap style="width: 100%">
        <div>{{ currentQuery }}</div>
        <el-alert title="請注意" type="warning" show-icon v-if="alertWords !== ''">
          <template #default>
            <span style="font-size: 1.5em">
              {{ alertWords }}
            </span>
          </template>
        </el-alert>
        <el-alert title="請注意" type="info" show-icon v-if="enableModify">
          <template #default>
            <span style="font-size: 1.5em">
              你已經啟動修改
            </span>
          </template>
        </el-alert>
        <el-switch v-if="editableSheet" class="ma1" size="large" active-text="我對這份存檔紀錄有意見，我要修改" v-model="enableModify"></el-switch>
        <el-space direction="vertical" fill wrap class="ma1 pa2 xs12" v-for="dataColumn in columnDB" :key="dataColumn.tid">
          <div v-if="!/G/.test(dataColumn.type)" class="qTitle xs12">{{ dataColumn.name }}</div>
          <div v-if="!/G/.test(dataColumn.type)" class="xs12">
            <span class="oriTip">
              {{ isAttachment(dataColumn) ? "[系統原本儲存的檔案（點擊開啟新連結）]" : "[系統原本儲存的答案]" }}
            </span>
            <span v-if="isAttachment(dataColumn)">
              <a :href="dataColumn.savedContent" target="_blank">{{ dataColumn.savedContent }}</a>
            </span>
            <span v-else>
              {{ dataColumn.savedContent }}
            </span>
          </div>
          <el-input
            v-show="enableModify"
            v-if="/P/.test(dataColumn.format)"
            size="large"
            class="xs12"
            :label="dataColumn.name"
            v-model="dataColumn.value"
            v-on:change="valField(dataColumn)"
            outline>
          </el-input>
          <el-input
            v-show="enableModify"
            v-if="/M|N|T|E/.test(dataColumn.format)"
            size="large"
            class="xs12"
            :label="dataColumn.name"
            v-model="dataColumn.value"
            v-on:change="valField(dataColumn)"
            outline>
          </el-input>
          <el-select
            v-show="enableModify"
            v-if="/S/.test(dataColumn.format)"
            v-model="dataColumn.value"
            class="xs12"
            :placeholder="dataColumn.name"
            size="large">
            <el-option
              v-for="item in dataColumn.content.split('|')"
              :key="item+dataColumn.tid+'key'"
              :label="item"
              :value="item"
              v-on:change="valField(dataColumn)"
            />
          </el-select>
          <el-button v-show="enableModify" v-if="/P/.test(dataColumn.format)" class="ma1 pa2 xs12" size="large" type="success" v-on:click="queryPC(dataColumn)">
            按此自動填入郵遞區號（但你得自己確認對不對）
          </el-button>
          <div v-show="enableModify" class="captionWord" v-if="dataColumn.nullable">這個欄位可以留空</div>
          <div v-show="enableModify" class="captionWord" v-if="dataColumn.group !== ''">這個欄位和另外一個欄位編為第{{ dataColumn.group }}組，你必須選一個填入，否則最後會不能存檔</div>
          <div v-show="enableModify" class="captionWord" v-if="dataColumn.status !== ''">{{ dataColumn.status }}</div>
        </el-space>
        <el-button class="ma1 pa2 xs12" size="large" type="danger" v-on:click="authMod()" :disabled="checkData()">
          {{ !checkData() ? "請再次確認後按此存檔並離開" : "你的格式有誤，請檢查" }}
        </el-button>
      </el-space>
  </el-dialog>
  <el-dialog
    :show-close="false"
    v-model="sheetsDialog.show"
    :fullscreen="sheetsDialog.fullscreen"
    title="可供檢視／填答的表單">
    <el-alert title="請稍後" type="info" show-icon v-if="loading">
      <template #default>
        <span style="font-size: 1.5em">資料載入中...</span>
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
      <div v-if="sheets.length === 0">無資料</div>
      <el-table :data="sheets" stripe style="width: 100%" v-else>
        <el-table-column prop="name" label="表單名稱" />
        <el-table-column label="開放截止日">
          <template #default="scope">
            <span>{{ dateConverter(scope.row.dueDate) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="">
          <template #default="scope">
            <span>
              <el-button class="ma1 pa2" size="large" type="primary" v-on:click="openSheet(scope.row.id)">{{ scope.row.record === '' ? "檢視" : "填寫" }}表單</el-button>
            </span>
          </template>
        </el-table-column>
      </el-table>
      <div class="footerText">Developer: Kelunyang@LKSH 2022 <a style="color:#CCC" target="_blank" href="https://github.com/kelunyang/sheet-machine" >GITHUB</a></div>
    </el-space>
  </el-dialog>
  <el-dialog
    :show-close="false"
    v-model="loginDialog.show"
    :fullscreen="loginDialog.fullscreen"
    title="請輸入你的個人資訊以確認身分">
    <el-alert title="請稍後" type="info" show-icon v-if="loading">
      <template #default>
        <span style="font-size: 1.5em">資料載入中...</span>
      </template>
    </el-alert>
    <el-alert title="發生錯誤" type="error" show-icon v-if="scriptError.message !== ''">
      <template #default>
        <span style="font-size: 1.5em">
          {{ scriptError.message }}
        </span>
      </template>
    </el-alert>
    <el-alert :title="saveSuccessed ? '儲存成功' : '儲存失敗'" :type="saveSuccessed ? 'success' : 'error'" show-icon v-if="saveSuccessed !== undefined">
      <template #default>
        <span style="font-size: 1.5em">
          {{ saveSuccessed ? "已寫入，你可以關閉視窗或是選別的問卷囉" : "發生錯誤：" + errorLog.join(',') }}
        </span>
      </template>
    </el-alert>
    <el-alert title="提示" type="warning" show-icon>
      <template #default>
        <span style="font-size: 1.5em">{{ loginTip }}</span>
      </template>
    </el-alert>
    <el-space direction="vertical" fill wrap style="width: 100%">
      <el-space direction="vertical" fill wrap class="ma1 pa2 xs12" v-for="authColumn in authDB" :key="authColumn.tid">
        <div class="qTitle xs12" v-if="!/G/.test(authColumn.type)">{{ authColumn.name }}</div>
        <el-input
          v-if="/I|N|T/.test(authColumn.format)"
          size="large"
          class="xs12"
          :label="authColumn.name"
          v-model="authColumn.value"
          :show-password="/P/.test(authColumn.type)"
          v-on:change="valField(authColumn)"
          outline>
        </el-input>
        <el-select
          v-if="/S/.test(authColumn.format)"
          v-model="authColumn.value"
          class="xs12"
          :placeholder="authColumn.name"
          size="large">
          <el-option
            v-for="item in authColumn.content.split('|')"
            :key="item+authColumn.tid+'key'"
            :label="item"
            :value="item"
            v-on:change="valField(authColumn)"
          />
        </el-select>
        <div class="captionWord" v-if="authColumn.status !== ''">{{ authColumn.status }}</div>
      </el-space>
      <el-button v-if="authDB.length > 0" class="ma1 pa1 xs12" size="large" type="danger" :disabled="checkAuth()" v-on:click="loginView">{{ checkAuth() ? "格式錯誤或有空值，修正後才可以送出" : "送出認證以檢視表單" }}</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="loadSheet()">回到問卷列表</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="viewLatest()">查看最後一位填寫者以及你是否曾填寫過</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="viewStat()">查看各班完成量</el-button>
      <div class="footerText">Developer: Kelunyang@LKSH 2022 <a style="color:#CCC" target="_blank" href="https://github.com/kelunyang/sheet-machine" >GITHUB</a></div>
    </el-space>
  </el-dialog>
  <el-dialog
    :show-close="false"
    v-model="confirmDialog.show"
    :fullscreen="confirmDialog.fullscreen"
    title="送出資料前再次確認身分">
    <el-alert title="請稍後" type="info" show-icon v-if="loading">
      <template #default>
        <span style="font-size: 1.5em">資料載入中...</span>
      </template>
    </el-alert>
    <el-alert title="發生錯誤" type="error" show-icon v-if="scriptError.message !== ''">
      <template #default>
        <span style="font-size: 1.5em">
          {{ scriptError.message }}
        </span>
      </template>
    </el-alert>
    <el-alert title="請注意！" type="info" show-icon>
      <template #default>
        <span style="font-size: 1.5em">送出前，請在此再次輸入你的身分資訊以確認是你本人！</span>
      </template>
    </el-alert>
    <el-space direction="vertical" fill wrap style="width: 100%">
      <el-space direction="vertical" fill wrap class="ma1 pa2 xs12" v-for="authColumn in authDB" :key="authColumn.tid">
        <div style="color: maroon" class="qTitle xs12" v-if="!/G/.test(authColumn.type)">{{ authColumn.name }}</div>
        <el-input
          v-if="/I|N|T/.test(authColumn.format)"
          size="large"
          class="xs12"
          :label="authColumn.name"
          v-model="authColumn.value"
          :show-password="/P/.test(authColumn.type)"
          v-on:change="valField(authColumn)"
          outline>
        </el-input>
        <el-select
          v-if="/S/.test(authColumn.format)"
          v-model="authColumn.value"
          class="xs12"
          :placeholder="authColumn.name"
          size="large">
          <el-option
            v-for="item in authColumn.content.split('|')"
            :key="item+authColumn.tid+'key'"
            :label="item"
            :value="item"
            v-on:change="valField(authColumn)"
          />
        </el-select>
        <div class="captionWord" v-if="authColumn.status !== ''">{{ authColumn.status }}</div>
      </el-space>
      <el-button class="ma1 pa2 xs12" size="large" type="danger" :disabled="checkAuth()" v-on:click="sendMod()">{{ checkAuth() ? "格式錯誤或有空值，修正後才可以送出" : "是的，我確定送出修改！" }}</el-button>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="reverseBody()">剛剛輸入的有誤，回去修改</el-button>
    </el-space>
  </el-dialog>
  <el-dialog
    :show-close="false"
    v-model="latestDialog.show"
    :fullscreen="latestDialog.fullscreen"
    title="最後一位填寫者以及你是否填過">
    <el-alert title="請稍後" type="info" show-icon v-if="loading">
      <template #default>
        <span style="font-size: 1.5em">資料載入中...</span>
      </template>
    </el-alert>
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
    title="各班填寫狀況統計">
    <el-space direction="vertical" fill wrap style="width: 100%">
      <el-table :data="stats" stripe style="width: 100%">
        <el-table-column prop="classno" label="班級" width="180" />
        <el-table-column label="填答率" width="180">
          <template #default="scope">
            <span>{{ scope.row.rate }}%</span>
          </template>
        </el-table-column>
        <el-table-column prop="unfinished" label="未完成者" />
      </el-table>
      <el-button class="ma1 pa2 xs12" size="large" type="primary" v-on:click="closeStat()">關閉對話框</el-button>
    </el-space>
  </el-dialog>
</template>

<script>
  import dayjs from 'dayjs';
  import { v4 as uuidv4 } from 'uuid';
  import _ from'lodash';
  export default {
    methods: {
      loadSheet: function() {
        let oriobj = this;
        this.loading = true;
        google.script.run.withSuccessHandler((list) => {
          oriobj.scriptError.message = "";
          for(let i=0; i<list.length; i++) {
            list[i].id = uuidv4();
          }
          oriobj.sheets = list;
          oriobj.saveSuccessed = undefined;
          oriobj.sheetsDialog.show = true;
          oriobj.loading = false;
        })
        .withFailureHandler((data) => {
          oriobj.scriptError = data;
          oriobj.loading = false;
        })
        .getQList();
      },
      reverseBody: function() {
        this.confirmDialog.show = false;
        this.columnDialog.show = true;
      },
      isAttachment: function(column) {
        if(/C/.test(column.type)) {
          if(/I/.test(column.format)) {
            return true;
          }
        }
        return false;
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
        if(column.value === "") {
          if(column.nullable) {
            skipnull = true;
          }
        }
        if(/F/.test(column.type)) {
          if(column.must) {
            if(column.value === "") {
              passMust = false;
              column.status = "這個欄位必填！";
            }
          }
        }
        if(passMust) {
          if(!skipnull) {
            if(/N|P/.test(column.format)) {
              let num = 0;
              if(/P/.test(column.format)) {
                let pConfig = column.content.split("|");
                num = parseInt(pConfig[0]);
              } else if(/N/.test(column.format)) {
                console.dir(column.content);
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
            } else if(/I/.test(column.format)) {
              if(/^[A-Z][12]\d{8}$/.test(column.value)) {
                column.status = "";
              } else {
                column.status = "這裡應該要輸入身分證號，如A123456789";
              }
            } else if(/E/.test(column.format)) {
              if(/^\w+((-\w+)|(\.\w+))*\@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(column.value)) {
                column.status = "";
              } else {
                column.status = "這裡應該輸入Email";
              }
            } else if(/M/.test(column.format)) {
              if(/^09\d{8}$/.test(column.value)) {
                column.status = "";
              } else {
                column.status = "這裡應該輸入電話號碼，如0912345678";
              }
            } else if(/T|D/.test(column.format)) {
              column.value = column.value.replace(/台北/,"臺北");
            } else if(/S/.test(column.format)) {
              if(new RegExp(column.value).test(column.content)) {
                column.status = "";
              } else {
                column.status = "你真的是用選單選出來的值嗎？";
              }
            }
          }
        }
      },
      dateConverter: function(tick) {
        let dayObj = dayjs(tick);
        return dayObj.format('YYYY-MM-DD HH:mm:ss')
      },
      openSheet: function(sid) {
        let oriobj = this;
        let sheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === sid;
        });
        this.loading = true;
        if(sheet.length > 0) {
          google.script.run
          .withSuccessHandler((headers) => {
            oriobj.scriptError.message = "";
            oriobj.currentSID = sheet[0].id;
            oriobj.currentQuery = sheet[0].name;
            oriobj.loginTip = sheet[0].loginTip;
            oriobj.editableSheet = sheet[0].record !== "";
            oriobj.alertWords = sheet[0].comment;
            for(let i=0;i<headers.length; i++) {
              headers[i].tid = uuidv4();
              headers[i].status = "";
            }
            oriobj.authDB = _.filter(headers, (header) => {
              return /A|P/.test(header.type);
            });
            let pkey = _.filter(headers, (header) => {
              return /P/.test(header.type);
            });
            if(pkey.length > 0) {
              oriobj.pkeyName = pkey[0].name;
            }
            oriobj.loading = false;
            oriobj.loginDialog.show = true;
            oriobj.sheetsDialog.show = false;
          })
          .withFailureHandler((data) => {
            oriobj.scriptError = data;
            oriobj.loading = false;
          }).publicHeader(sheet[0].refer);
        }
      },
      viewLatest: function() {
        let oriobj = this;
        let sheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === oriobj.currentSID;
        });
        this.loading = true;
        if(sheet.length > 0) {
          google.script.run
          .withSuccessHandler((latest) => {
            oriobj.scriptError.message = "";
            latest.tick = parseInt(latest.tick);
            latest.modified = /true|TRUE/.test(latest.modified) ? true : false;
            oriobj.lastSender = latest;
            oriobj.loading = false;
            oriobj.latestDialog.show = true;
          })
          .withFailureHandler((data) => {
            oriobj.scriptError = data;
            oriobj.loading = false;
          }).latestSubmits(sheet[0].record);
        }
      },
      queryExist: function() {
        let oriobj = this;
        let sheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === oriobj.currentSID;
        });
        this.loading = true;
        if(sheet.length > 0) {
          google.script.run
          .withSuccessHandler((requested) => {
            oriobj.scriptError.message = "";
            oriobj.requestedUser = "";
            requested.modified = /true|TRUE/.test(requested.modified) ? true : false;
            requested.lastTick = parseInt(requested.lastTick);
            oriobj.requestCount = requested;
            oriobj.loading = false;
          })
          .withFailureHandler((data) => {
            oriobj.scriptError = data;
            oriobj.loading = false;
          }).duplicateSubmits(sheet[0].record, this.requestedUser);
        }
      },
      viewStat: function() {
        let oriobj = this;
        let sheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === oriobj.currentSID;
        });
        this.loading = true;
        if(sheet.length > 0) {
          google.script.run
          .withSuccessHandler((statsObj) => {
            oriobj.scriptError.message = "";
            oriobj.stats = statsObj;
            oriobj.loading = false;
            oriobj.statDialog.show = true;
          })
          .withFailureHandler((data) => {
            oriobj.scriptError = data;
            oriobj.loading = false;
          }).compareSheets(sheet[0].refer, sheet[0].record);
        }
      },
      sendMod: function() {
        let oriobj = this;
        let currentSheet = _.filter(this.sheets, (sheet) => {
          return sheet.id === oriobj.currentSID;
        });
        if(currentSheet.length > 0) {
          this.loading = true;
          google.script.run
            .withSuccessHandler((report) => {
              oriobj.scriptError.message = "";
              oriobj.saveSuccessed = report.status;
              oriobj.errorLog = report.errorLog;
              oriobj.columnDialog.show = false;
              oriobj.confirmDialog.show = false;
              oriobj.loading = false;
              if(oriobj.saveSuccessed) {
                oriobj.columnDB = [];
                oriobj.authDB = [];
                oriobj.enableModify = false;
              }
              oriobj.loginDialog.show = true;
            })
            .withFailureHandler((data) => {
              oriobj.scriptError = data;
              oriobj.loading = false;
            }).writeRecord(currentSheet[0].refer, currentSheet[0].record, this.authDB, this.columnDB, this.enableModify);
        }
      },
      closeLatest: function() {
        this.latestDialog.show = false;
      },
      closeStat: function() {
        this.statDialog.show = false;
      },
      authMod: function() {
        for(let i=0; i<this.authDB.length; i++) {
          this.authDB[i].value = "";
          this.authDB[i].status = "";
        }
        this.columnDialog.show = false;
        this.confirmDialog.show = true;
      },
      queryPC: function(pColumn) {
        let oriobj = this;
        this.loading = true;
        let pConfig = pColumn.content.split("|");
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
          let postCode = JSON.parse(pStr);
          if(postCode !== undefined) {
            if(postCode.zipcode !== undefined) {
              if(postCode.zipcode !== "") {
                pColumn.value = postCode.zipcode.substring(0, parseInt(pConfig[0]));
              } else {
                pColumn.status = "找不到你提供的地址所屬的郵遞區號，請修正地址或者自己輸入";
              }
            } else {
              pColumn.status = "找不到你提供的地址所屬的郵遞區號，請修正地址或者自己輸入";
            }
          } else {
            pColumn.status = "找不到你提供的地址所屬的郵遞區號，請修正地址或者自己輸入";
          }
          oriobj.loading = false;
        })
        .withFailureHandler((data) => {
          oriobj.scriptError = data;
          oriobj.loading = false;
        }).queryPC(address);
      },
      loginView: function() {
        if(!this.checkAuth()) {
          let oriobj = this;
          let sheet = _.filter(this.sheets, (sheet) => {
            return sheet.id === oriobj.currentSID;
          });
          this.loading = true;
          if(sheet.length > 0) {
            google.script.run
            .withSuccessHandler((columns) => {
              oriobj.scriptError.message = "";
              oriobj.loading = false;
              if(!columns) {
                oriobj.scriptError.message = "登入失敗，請再次確認你的個人資訊，請注意，如果多次失敗，這代表你存在校務行政系統裡的基本資訊應該是錯的（請洽教務處註冊組）或者是你不在這份問卷許可的填寫者名單中";
              } else {
                oriobj.columnDB = _.filter(columns, (column) => {
                  return /F|C|G/.test(column.type);
                });
                for(let i=0;i<oriobj.columnDB.length; i++) {
                  oriobj.columnDB[i].tid = uuidv4();
                  oriobj.columnDB[i].status = "";
                }
                oriobj.loginDialog.show = false;
                oriobj.columnDialog.show = true;
              }
            })
            .withFailureHandler((data) => {
              oriobj.scriptError = data;
              oriobj.loading = false;
            }).readRecord(sheet[0].refer, this.authDB);
          }
        }
      }
    },
    mounted() {
      this.loadSheet();
    },
    data() {
      return {
        pkeyName: "",
        requestedUser: "",
        loginTip: "",
        saveSuccessed: undefined,
        errorLog: [],
        editableSheet: false,
        currentSID: "",
        loading: false,
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
        stats: []
      };
    },
  };
</script>