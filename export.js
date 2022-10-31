/* 請把下面的程式碼貼在你的列表清單試算表的app script裡面 */
const _ = LodashGS.load();
const ui = SpreadsheetApp.getUi(); // Same variations.
const appProperties = PropertiesService.getScriptProperties();

function exportSheet() {
  let response = ui.prompt('問卷匯出機器人','請問你要開始匯出問卷了嗎？\n請輸入你想匯出的問卷在試算表裡的「行號」（從第2行開始）', ui.ButtonSet.YES_NO);
  if (response.getSelectedButton() == ui.Button.NO) {
    ui.alert("操作取消！");
  } else if (response.getSelectedButton() == ui.Button.YES) {
    let start = (new Date()).getTime();
    let rowID = parseInt(response.getResponseText());
    //let rowID = 2;
    let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheet'));
    let listSheet = listSS.getSheets()[0];
    let listRange = listSheet.getRange("A:G");
    let listArr = listRange.getValues();
    let writeSID = "";
    let destFolder = DriveApp.getFolderById(appProperties.getProperty('exportStorage'));
    let copyPrompt = ui.prompt('資料從哪一行開始','你的寫入表資料標題有幾行？請自行輸入（如果你不知道請輸入2）', ui.ButtonSet.OK);
    if(copyPrompt.getSelectedButton() === ui.Button.OK) {
      let uniquePrimary = true;
      var result = ui.alert(
                  '只看用戶寫的最新的那筆？',
                  '如果你按下OK，輸出時系統會自動過濾用戶輸出結果，只輸出他們寫的最新的那筆',
                    ui.ButtonSet.YES_NO);
      uniquePrimary = result == ui.Button.YES;
      let sheetData = listArr[rowID-1];
      let headerCount = parseInt(copyPrompt.getResponseText());
      //let headerCount = 2;
      let existCheck = DriveApp.searchFiles('parents in "' + appProperties.getProperty('exportStorage') + '" and title contains "' + sheetData[0].toString() + '"');
      while (existCheck.hasNext()) {
        let file = existCheck.next();
        writeSID = file.getId();
        break;
      }
      let referSS = SpreadsheetApp.openById(sheetData[1].toString());
      let referSheet = referSS.getSheets()[0];
      let referRange = referSheet.getDataRange();
      let referArr = referRange.getValues();
      let headers = [];
      if(referArr.length > 3) {
        if(referArr[2].length > 0) {
          for(let i=0; i<referArr[2].length; i++) {
            if(/G|O|C|A|P|F/.test(referArr[2][i].toString())) {
              headers.push({
                type: referArr[2][i].toString(),
                format: referArr[3][i].toString(),
                pos: i
              });
            }
          }
        }
      }
      let recordSS = SpreadsheetApp.openById(sheetData[2].toString());
      let recordSheet = recordSS.getSheets()[0];
      let recordRange = recordSheet.getDataRange();
      let recordArr = recordRange.getValues();
      let newSS = writeSID === "" ? SpreadsheetApp.create(sheetData[0].toString()) : SpreadsheetApp.openById(writeSID);
      let now = new Date();
      let sheetName = "輸出日期：" + now.toLocaleString();
      let newSheet = newSS.insertSheet(sheetName);
      if(writeSID === "") {
        let newSheets = newSS.getSheets();
        for(let i=0; i<newSheets.length; i++) {
          if(newSheets[i].getName() !== sheetName) {
            newSS.deleteSheet(newSheets[i]);
          }
        }
      }
      for(let i=0; i<headerCount; i++) {
        if(i < recordArr.length) {
          newSheet.appendRow(recordArr[i]);
        }
      }
      recordArr.splice(0, headerCount);
      let resultArr = [];
      let pirmaryKeys = _.uniq(_.map(recordArr, (row) => {
        return row[2].toString();
      }));
      for(let i=0; i<pirmaryKeys.length; i++) {
        let sameKey = _.filter(recordArr, (row) => {
          return row[2].toString() === pirmaryKeys[i]
        });
        if(sameKey.length > 1) {
          let orderedRows = _.orderBy(sameKey, (key) => { return key[0] }, ['desc']);
          if(orderedRows.length > 0) {
            if(uniquePrimary) {
              resultArr.push(injectRefer(pirmaryKeys[i], headers, orderedRows[0], referArr));
            } else {
              for(let k=0; k<orderedRows.length; k++) {
                resultArr.push(injectRefer(pirmaryKeys[i], headers, orderedRows[k], referArr));
              }
            }
          }
        } else if(sameKey.length === 1) {
          resultArr.push(injectRefer(pirmaryKeys[i], headers, sameKey[0], referArr));
        }
      }
      resultArr = _.orderBy(resultArr, (key) => { return key[0] }, ['asc']);
      if(resultArr.length > 0) {
        let lengthnotMatch = 0;
        for(let i=0; i<resultArr.length; i++) {
          let time = new Date(resultArr[i][0]);
          resultArr[i][0] = time.toLocaleString();
        }
        let maxRow = resultArr[0].length;
        for(let i=0; i<resultArr.length; i++) {
          if(resultArr[i].length > maxRow) {
            maxRow = resultArr[i].length;
          }
        }
        for(let i=0; i<resultArr.length; i++) {
          if(resultArr[i].length < maxRow) {
            lengthnotMatch++;
            let diff = maxRow - resultArr[i].length;
            for(let k=0; k<diff; k++) {
              resultArr[i].push("");
            }
          }
        }
        let newRange = newSheet.getRange(headerCount + 1,1,resultArr.length, maxRow);
        newRange.setValues(resultArr);
        /*for(let i=0; i<resultArr.length; i++) {
          newSheet.appendRow(resultArr[i]);
        }*/
        SpreadsheetApp.flush();
        if(writeSID === "") {
          DriveApp.getFileById(newSS.getId()).moveTo(destFolder); 
        }
        let end = (new Date()).getTime();
        ui.alert("「" + sheetData[0].toString() + "」輸出完成！\n原始資料有" + recordArr.length + "行，輸出後為" + resultArr.length + "行！\n有" + lengthnotMatch + "行長度和其他人對不起來，可能是簽名檔遺失，請自行打開輸出檔案之後檢查\n請記得自己刪掉數字前面的「📝」（為了避免數字前的0被吃掉）\n本次匯出耗時" + (end - start) / 1000 + '秒\n輸出的位置是' + destFolder.getName() + "\\" + sheetData[0].toString() + "\\" + "輸出日期：" + now.toLocaleString());
      }
    }
  }
}

function injectRefer(key, headers, row, data) { //應該在這裡，要根據簽名挪移位置，然後尋找檔案ID轉換成url
  let returnRow = [];
  let dataFrom = 5;
  let pKey = _.filter(headers, (h) => {
    return /P/.test(h.type);
  });
  if(pKey.length > 0) {
    let referRow = _.filter(data, (row) => {
      return row[pKey[0].pos].toString() === key;
    });
    if(referRow.length > 0) {
      for(let i=0; i< headers.length; i++) {
        if(!/F/.test(headers[i].type)) {
          row[dataFrom + headers[i].pos] = /N|M|P|G/.test(headers[i].format) ? "📝" + referRow[0][headers[i].pos].toString() : referRow[0][headers[i].pos].toString();
        }/* else {
          if(/F/.test(headers[i].format)) {
            let fileID = referRow[0][headers[i].pos].toString();
            if(fileID !== "") {
              let file = DriveApp.getFileById(referRow[0][headers[i].pos].toString());
              row[dataFrom + headers[i].pos] = file.getUrl();
            }
          }
        }*/
      }
      returnRow.push(row[0]);
      returnRow.push(row[1]);
      returnRow.push(row[2]);
      returnRow.push(row[4]);
      let signatures = row[3].toString() === "" ? [] : row[3].toString().split(";");
      for(let k=0; k<signatures.length; k++) {
        let file = DriveApp.getFileById(signatures[k]);
        returnRow.push(file.getUrl());
      }
      for(let k=dataFrom; k<row.length; k++) {
        let columnConfig = _.filter(headers, (header) => {
          return header.pos === k - dataFrom;
        })
        if(columnConfig.length > 0) {
          if(/F/.test(columnConfig[0].format)) {
            if(row[k].toString() !== "") {
              let file = DriveApp.getFileById(row[k].toString());
              returnRow.push(file.getUrl());
            } else {
              returnRow.push("無檔案");
            }
          } else {
            returnRow.push(row[k].toString());
          }
        }
      }
    } else {
      returnRow = row;
    }
  } else {
    returnRow = row;
  }
  return returnRow;
}
