const _ = LodashGS.load();

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('index')
  var html = template.evaluate()
    .setTitle('林口高中註冊組線上問卷系統');
  
  var htmlOutput = HtmlService.createHtmlOutput(html);
  htmlOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return htmlOutput;
}

function getQList() {
  let listSS = SpreadsheetApp.openById("1X_eia84M-lcIm8YS-hhOIiXGuYoHTGICLgL06UU3C1Q");
  let listSheet = listSS.getSheetByName("本表勿刪");
  let listRange = listSheet.getRange("A:F");
  let listArr = listRange.getValues();
  let lists = [];
  if(listArr.length > 1) {
    for(let i=1; i<listArr.length; i++) {
      let row = listArr[i];
      if(row.length > 0) {
        if(row[0].toString() !== "") {
          lists.push({
            record: row[2].toString().trim(),
            name: row[0].toString().trim(),
            refer: row[1].toString().trim(),
            dueDate: parseInt(row[3].toString().trim()),
            comment: row[4].toString().trim(),
            loginTip: row[5].toString().trim(),
          })
        }
      }
    }
  }
  return lists;
}

function readRecord(referSSID, auth) {
  if(authRecord(referSSID, auth)) {
    let headers = getHeaders(referSSID);
    let pkeys = _.filter(headers, (header) => {
      return /P/.test(header.type);
    });
    if(pkeys.length > 0) {
      let uKeys = _.filter(auth, (aObj) => {
        return aObj.id === pkeys[0].id;
      });
      if(uKeys.length > 0) {
        let referSS = SpreadsheetApp.openById(referSSID);
        let referSheet = referSS.getSheetByName("參照表");
        let referRange = referSheet.getDataRange();
        let referArr = referRange.getValues();
        let userRows = _.filter(referArr, (rObj) => {
          return rObj[pkeys[0].pos].toString() === uKeys[0].value;
        });
        if(userRows.length > 0) {
          for(let i=0; i<headers.length; i++) {
            let column = headers[i];
            if(/C/.test(column.type)) {
              if(/I/.test(column.format)) {
                let imgContent = userRows[0][column.pos].toString();
                let files = DriveApp.searchFiles('parents in "16o9TvQOTHtSL6tI-GzbeSh8hCYFaEuiG" and title contains \'"' + imgContent + '"\'');
                while (files.hasNext()) {
                  var file = files.next();
                  column.savedContent = file.getUrl();
                }
              }
            } else if(/F|G/.test(column.type)) {
              column.savedContent = userRows[0][column.pos].toString();
              column.value = column.savedContent;
            }
            column.pos = undefined;
          }
          return headers;
        }
      }
    }
  }
  return false;
}

function queryPC(address) {
  let postCodeAPI = UrlFetchApp.fetch("https://kelunyang.duckdns.org/addr.php?address=" + address);
  return postCodeAPI.getContentText();
}

function publicHeader(referSSID) {
  let headers = getHeaders(referSSID);
  for(let i=0;i<headers.length; i++) {
    let column = headers[i];
    column.pos = undefined;
  }
  return headers;
}

function getHeaders(referSSID) {
  let referSS = SpreadsheetApp.openById(referSSID);
  let referSheet = referSS.getSheetByName("參照表");
  let referRange = referSheet.getDataRange();
  let referArr = referRange.getValues();
  let headers = [];
  if(referArr.length > 1) {
    if(referArr[0].length > 0) {
      for(let i=0; i<referArr[0].length; i++) {
        if(referArr[0][0].toString() !== "") {
          let obj = {
            id: referArr[0][i].toString().trim(),
            name: referArr[1][i].toString().trim(),
            type: referArr[2][i].toString().trim(),
            format: referArr[3][i].toString().trim(),
            group: referArr[4][i].toString().trim(),
            content: referArr[5][i].toString().trim(),
            must: referArr[6][i].toString().trim() === "M",
            nullable: referArr[7][i].toString().trim() === "N",
            pos: i,
            value: ""
          };
          if(obj.group !== "") {
            obj.group = parseInt(obj.group)
          }
          headers.push(obj);
        }
      }
    }
  }
  return headers;
}

function authRecord(referSSID, auth) {
  let referSS = SpreadsheetApp.openById(referSSID);
  let referSheet = referSS.getSheetByName("參照表");
  let referRange = referSheet.getDataRange();
  let referArr = referRange.getValues();
  let headers = getHeaders(referSSID);
  for(let i=0; i<auth.length; i++) {
    auth[i].accept = false;
  }
  let pKey = _.filter(headers, (header) => {
    return /P/.test(header.type);
  });
  if(pKey.length > 0) {
    let uKey = _.filter(auth, (aObj) => {
      return aObj.id === pKey[0].id;
    });
    if(uKey.length > 0) {
      let userRow = _.filter(referArr, (row) => {
        return row[pKey[0].pos].toString() === uKey[0].value;
      })
      if(userRow.length > 0) {
        uKey[0].accept = true;
        for(let i=0; i<auth.length; i++) {
          let aColumn = _.filter(headers, (header) => {
            return header.id === auth[i].id;
          });
          if(aColumn.length > 0) {
            if(/A/.test(aColumn[0].type)) {
              if(userRow[0][aColumn[0].pos].toString() === auth[i].value) {
                auth[i].accept = true;
              } else {
                break;
              }
            } else if(/G/.test(aColumn[0].type)) {
              auth[i].accept = true;
            }
          } else {
            break;
          }
        }
        return _.every(auth, { 'accept': true });
      }
    }
  }
  return false;
}

function writeRecord(referSSID, recordSSID, auth, record, accept) {
  let listSS = SpreadsheetApp.openById("1X_eia84M-lcIm8YS-hhOIiXGuYoHTGICLgL06UU3C1Q");
  let listSheet = listSS.getSheetByName("本表勿刪");
  let listRange = listSheet.getRange("A:E");
  let listArr = listRange.getValues();
  let pureData = [(new Date()).getTime(), accept];
  let proceedWrite = true;
  let errorLog = [];
  let primaryData = "";
  let groupData = "";
  let hasGroup = false;
  let currentSheet = _.filter(listArr, (sheet) => {
    if(sheet[1].toString().trim() === referSSID) {
      if(sheet[2].toString().trim() === recordSSID) {
        return true;
      }
    }
    return false;
  });
  if(currentSheet.length > 0) {
    if((new Date()).getTime() > parseInt(currentSheet[0][3].toString())) {
      proceedWrite = false;
      errorLog.push("表單已過時");
    }
  }
  if(proceedWrite) {
    let headers = getHeaders(referSSID);
    let columnGroups = _.uniq(_.map(headers, 'group'));
    for(let i=0; i<record.length; i++) {
      let data = record[i];
      let column = _.filter(headers, (header) => {
        return header.id === data.id;
      });
      if(column.length > 0) {
        data.pos = column[0].pos
      }
    }
    record = _.orderBy(record, ['pos'], ['asc']);
    for(let i=0; i<record.length; i++) {
      if(proceedWrite) {
        let data = record[i];
        let columns = _.filter(headers, (header) => {
          return header.id === data.id;
        });
        if(columns.length > 0) {
          let column = columns[0];
          if(column.nullable) {
            if(data.value === "") {
              data.value = "不提供資料";
            }
          }
          if(column.must) {
            if(data.value === "") {
              proceedWrite = false;
              errorLog.push(column.name + "必填！");
            } else {
              proceedWrite = true;
            }
          }
          if(/F|C/.test(column.type)) {
            if(proceedWrite) {
              if(data.value !== "不提供資料") {
                if(/N|P/.test(column.format)) {
                  let numLength = 0;
                  if(/P/.test(column.format)) {
                    let pConfig = column.content.split("|");
                    numLength = parseInt(pConfig[0]);
                  } else if(/N/.test(column.format)) {
                    if(column.content !== "") {
                      numLength = parseInt(column.content);
                    }
                  }
                  let zeroIndicator = numLength === 0 ? "0" : "";
                  numLength = numLength > 0 ? "{" + numLength + "}" : "*";
                  if(new RegExp("^" + zeroIndicator + "\\d" + numLength + "$").test(data.value)) {
                    column.value = "📝"+data.value;
                  } else {
                    proceedWrite = false;
                  }
                } else if(/I/.test(column.format)) {
                  if(/F/.test(column.type)) {
                    if(/^[A-Z][12]\d{8}$/.test(data.value)) {
                      column.value = data.value;
                    } else {
                      proceedWrite = false;
                    }
                  }
                } else if(/E/.test(column.format)) {
                  if(/^\w+((-\w+)|(\.\w+))*\@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(data.value)) {
                    column.value = data.value;
                  } else {
                    proceedWrite = false;
                  }
                } else if(/M/.test(column.format)) {
                  if(/^09\d{8}$/.test(data.value)) {
                    column.value = "📝"+data.value;
                  } else {
                    proceedWrite = false;
                  }
                } else if(/T/.test(column.format)) {
                  if(new RegExp(column.content).test(data.value)) {
                    column.value = data.value.replace(/台北/,"臺北");
                  } else {
                    proceedWrite = false;
                  }
                } else if(/S/.test(column.format)) {
                  if(new RegExp(data.value).test(column.content)) {
                    column.value = data.value;
                  } else {
                    proceedWrite = false;
                  }
                }
                if(!proceedWrite) {
                  errorLog.push(column.name + "格式錯誤！");
                }
              }
            }
          } else if(/G/.test(column.type)) {
            groupData = data.value;
            hasGroup = true;
          } else {
            proceedWrite = false;
            errorLog.push("你竄改數據？" + column.name + "不允許寫入！");
          }
        } else {
          proceedWrite = false;
          errorLog.push("你竄改數據？根本沒有這個欄位啊！");
        }
      } else {
        break;
      }
    }
    if(proceedWrite) {
      for(let i=0; i<columnGroups.length; i++) {
        if(columnGroups[i] !== "") {
          if(_.every(headers, { group: columnGroups[i], value: "" })) {
            proceedWrite = false;
            errorLog.push("第" + columnGroups[i] + "群組欄位不得均為空");
            break;
          }
          let groupTest = _.filter(headers, (header) => {
            return header.group === columnGroups[i];
          });
          let uniqed = _.uniqBy(groupTest, (item) => {
            return item.value.toString().trim();
          });
          if(groupTest.length !== uniqed.length) {
            proceedWrite = false;
            errorLog.push("第" + columnGroups[i] + "群組欄位，不得重複");
            break;
          }
        }
      }
    }
    if(proceedWrite) {
      if(authRecord(referSSID, auth)) {
        for(let i=0; i<auth.length; i++) {
          let authObjs = _.filter(headers, (header) => {
            return header.id === auth[i].id;
          });
          if(authObjs.length > 0) {
            if(/P/.test(authObjs[0].type)) {
              primaryData = auth[i].value;
            }
          }
        }
        pureData.push(primaryData);
        if(!hasGroup) { groupData = "" }
        pureData.push(groupData);
        for(let i=0; i<headers.length; i++) {
          pureData.push(headers[i].value.toString());
        }
        let recordSS = SpreadsheetApp.openById(recordSSID);
        let recordSheet = recordSS.getSheetByName("寫入表");
        recordSheet.appendRow(pureData);
        return {
          status: true,
          errorLog: errorLog
        };
      }
    }
  }
  return {
    status: false,
    errorLog: errorLog
  };
}

function duplicateSubmits(recordSSID, qPkey) {
  let recordSS = SpreadsheetApp.openById(recordSSID);
  let recordSheet = recordSS.getSheetByName("寫入表");
  let recordRange = recordSheet.getDataRange();
  let recordArr = recordRange.getValues();
  let userRecords = _.filter(recordArr, (arr) => {
    return arr[2].toString() === qPkey;
  });
  let returnArr = userRecords.length > 0 ? userRecords[userRecords.length - 1] : [];
  return {
    length: userRecords.length,
    modified: returnArr.length > 0 ? returnArr[1] : "",
    lastTick: returnArr.length > 0 ? returnArr[0] : "",
    pkey: maskString(qPkey)
  };
}

function latestSubmits(recordSSID) {
  let recordSS = SpreadsheetApp.openById(recordSSID);
  let recordSheet = recordSS.getSheetByName("寫入表");
  let totalRange = recordSheet.getDataRange();
  let totalArr = totalRange.getValues();
  let latestArr = _.last(totalArr);
  return {
    tick: latestArr.length > 0 ? latestArr[0].toString() : 0,
    modified: latestArr.length > 0 ? latestArr[1].toString() : false,
    pkey: latestArr.length > 0 ? maskString(latestArr[2].toString()) : ""
  };
}

function maskString(str) {
  return str.replace(/(.{1})./g, "$1*");
}

function compareSheets(referSSID, recordSSID) {
    let recordSS = SpreadsheetApp.openById(recordSSID);
    let recordSheet = recordSS.getSheetByName("寫入表");
    let recordRange = recordSheet.getDataRange();
    let recordArr = recordRange.getValues();
    let referSS = SpreadsheetApp.openById(referSSID);
    let referSheet = referSS.getSheetByName("參照表");
    let referRange = referSheet.getDataRange();
    let referArr = referRange.getValues();
    let headers = getHeaders(referSSID);
    let groupColumns = _.filter(headers, (header) => {
      return /G/.test(header.type);
    });
    let pkeyColumns = _.filter(headers, (header) => {
      return /P/.test(header.type);
    })
    let result = [];
    if(pkeyColumns.length > 0) {
      if(groupColumns.length > 0) {
        referArr.splice(0,7);
        let groupsTemp = _.uniqBy(referArr, (row) => {
          return row[groupColumns[0].pos].toString().trim();
        });
        let groups = [];
        for(let i=0; i<groupsTemp.length;i++) {
          groups.push(groupsTemp[i][groupColumns[0].pos].toString().trim());
        }
        for(let i=0; i<groups.length; i++) {
          if(groups[i] !== "") {
            let referTemp = _.filter(referArr, (refer) => {
              return refer[groupColumns[0].pos].toString().trim() === groups[i];
            });
            let referCount = [];
            for(let k=0; k<referTemp.length; k++) {
              referCount.push(referTemp[k][pkeyColumns[0].pos].toString().trim());
            }
            let recordTemp = _.filter(recordArr, (record) => {
              return record[3].toString().trim() === groups[i].toString();
            });
            let recordCount = [];
            for(let k=0; k<recordTemp.length; k++) {
              recordCount.push(recordTemp[k][2].toString().trim());
            }
            recordCount = _.uniq(recordCount);
            referCount = _.uniq(referCount);
            let rate = ((recordCount.length / referCount.length) * 100).toFixed(0);
            let unfinished = _.differenceWith(referCount, recordCount, (existed, written) => {
              return existed === written;
            });
            if(unfinished.length <= 3) {
              let temp = [];
              for(let i=0; i<unfinished.length; i++) {
                temp.push(maskString(unfinished[i].toString()));
              }
              returnList = temp.join(",");
            } else if(unfinished.length > 3) {
              returnList = unfinished.length + "人，共" + referCount.length + "人（超過3人不顯示名單）";
            }
            result.push({
              classno: groups[i],
              rate: rate,
              unfinished: returnList
            });
          }
        }
      }
    }
    return result;
}