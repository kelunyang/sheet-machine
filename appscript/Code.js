const _ = LodashGS.load();
const appProperties = PropertiesService.getScriptProperties();

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('index')
  var html = template.evaluate()
    .setTitle(appProperties.getProperty('systemTitle'));
  
  var htmlOutput = HtmlService.createHtmlOutput(html);
  htmlOutput.addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return htmlOutput;
}

function getQList() {
  let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
  let listSheet = listSS.getSheets()[0];
  let listRange = listSheet.getRange("A:O");
  let listArr = listRange.getValues();
  let lists = [];
  if(listArr.length > 1) {
    for(let i=1; i<listArr.length; i++) {
      let row = listArr[i];
      if(row.length > 0) {
        if(row[0].toString() !== "") {
          if(row[11].toString() === "是") {
            lists.push({
              record: row[2].toString().trim(),
              name: row[0].toString().trim(),
              refer: row[1].toString().trim(),
              dueDate: parseInt(row[3].toString().trim()),
              viewDate: parseInt(row[4].toString().trim()),
              enableModify: row[5].toString().trim() === "否" ? false : true,
              signatures: row[6].toString() === "" ? [] : row[6].toString().trim().split(";"),
              comment: row[7].toString().trim(),
              loginTip: row[8].toString().trim(),
              submitTip: row[9].toString().trim(),
              loginfailTip: row[10].toString().trim(),
              email: row[12].toString().trim(),
              externalID: row[13].toString().trim(),
              writeAllowed: row[14].toString().trim() === "是" ? true : false
            });
          }
        }
      }
    }
  }
  let outofDate = _.filter(lists, (item) => {
    return item.dueDate < (new Date()).getTime();
  });
  for(let i=0; i<outofDate.length; i++) {
    outofDate[i].signatures = [];
    outofDate[i].enableModify = false;
  }
  return _.filter(lists, (item) => {
    return item.viewDate > (new Date()).getTime();
  });
}

function getGoogleID() {
  return Session.getActiveUser().getEmail();
}

function readRecord(referSSID, recordSSID, auth) {
  if(authRecord(referSSID, auth)) {
    let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
    let listSheet = listSS.getSheets()[0];
    let listRange = listSheet.getRange("A:O");
    let listArr = listRange.getValues();
    let currentSheet = _.filter(listArr, (sheet) => {
      if(sheet[1].toString().trim() === referSSID) {
        if(sheet[2].toString().trim() === recordSSID) {
          return true;
        }
      }
      return false;
    });
    let signatures = [];
    if(currentSheet.length > 0) {
      if(currentSheet[0][14].toString().trim() === "是") {
        let headers = getHeaders(referSSID);
        let pkeys = _.filter(headers, (header) => {
          return /P/.test(header.type);
        });
        if(pkeys.length > 0) {
          let uKeys = _.filter(auth, (aObj) => {
            return aObj.id === pkeys[0].id;
          });
          if(uKeys.length > 0) {
            let userRows = getUserRow(referSSID, auth);
            if(userRows.length > 0) {
              let recordSS = SpreadsheetApp.openById(recordSSID);
              let recordSheet = recordSS.getSheets()[0];
              let recordRange = recordSheet.getDataRange();
              let recordArr = recordRange.getValues();
              let userRecords = _.filter(recordArr, (arr) => {
                return arr[2].toString() === uKeys[0].value;
              });
              let userRecord = userRecords.length > 0 ? userRecords[userRecords.length - 1] : undefined;
              if(userRecord !== undefined) {
                if(userRecord[3].toString() !== "") {
                  let signs = userRecord[3].toString().trim().split(";");
                  for(let i=0; i<signs.length; i++) {
                    let file = DriveApp.getFileById(signs[i]);
                    signatures.push(file.getUrl());
                  }
                }
              }
              for(let i=0; i<headers.length; i++) {
                let column = headers[i];
                column.lastInput = undefined;
                if(/C/.test(column.type)) {
                  if(/F/.test(column.format)) {
                    let imgContent = userRows[0][column.pos].toString().trim()
                    if(imgContent !== "") {
                      let storageID = column.content === "" ? appProperties.getProperty('universalStorageID') : column.content;
                      let files = DriveApp.searchFiles('parents in "'+ storageID +'" and title contains "' + imgContent + '"');
                      while(files.hasNext()) {
                        var file = files.next();
                        column.savedContent = file.getUrl();
                      }
                    } else {
                      column.savedContent = "";
                    }
                  } else if(/T/.test(column.format)) {
                    column.savedContent = userRows[0][column.pos].toString();
                  }
                } else if(/F|G/.test(column.type)) {
                  column.savedContent = userRows[0][column.pos].toString();
                  column.value = column.savedContent;
                  if(/F/.test(column.type)) {
                    if(/F/.test(column.format)) {
                      let fileContent = userRows[0][column.pos].toString().trim();
                      if(fileContent !== "") {
                        let storageID = appProperties.getProperty('universalStorageID');
                        if(column.content !== "") {
                          let contentConfig = column.content.split(";");
                          if(contentConfig[3] !== "") { storageID = contentConfig[3]; }
                        }
                        let files = DriveApp.searchFiles('parents in "'+ storageID +'" and title contains "' + fileContent + '"');
                        while (files.hasNext()) {
                          var file = files.next();
                          column.savedContent = file.getUrl();
                        }
                      } else {
                        column.savedContent = "";
                      }
                      if(userRecord !== undefined) {
                        if(userRecord[column.pos + 5] != null) {
                          fileContent = userRecord[column.pos + 5].toString().trim();
                          if(fileContent !== "") {
                            let file = DriveApp.getFileById(fileContent);
                            column.lastInput = file.getUrl();
                          } else {
                            column.lastInput = undefined;
                          }
                        } else {
                          column.lastInput = undefined;
                        }
                      } else {
                        column.lastInput = undefined;
                      }
                      column.value = "";
                    } else {
                      if(userRecord !== undefined) {
                        if(userRecord[column.pos + 5] != null) {
                          column.lastInput = userRecord[column.pos + 5].toString().replace(/📝/, "");
                          column.value = column.lastInput;
                        } else {
                          column.lastInput = "";
                        }
                      }
                    }
                  }
                }
                column.pos = undefined;
              }
              return {
                status: {
                  length: userRecords.length,
                  modified: userRecord !== undefined ? userRecord[1] : "",
                  lastTick: userRecord !== undefined ? userRecord[0] : "",
                  pkey: maskString(pkeys[0].id)
                },
                emailQuota: MailApp.getRemainingDailyQuota(),
                signatures: signatures,
                headers: headers
              };
            }
          }
        }
      }
    }
  }
  return false;
}

function getUserRow(referSSID, auth) {
  let referSS = SpreadsheetApp.openById(referSSID);
  let referSheet = referSS.getSheets()[0];
  let referRange = referSheet.getDataRange();
  let referArr = referRange.getValues();
  let headers = getHeaders(referSSID);
  let pKey = _.filter(headers, (header) => {
    return /P/.test(header.type);
  });
  if(pKey.length > 0) {
    let uKey = _.filter(auth, (aObj) => {
      return aObj.id === pKey[0].id;
    });
    if(uKey.length > 0) {
      return _.filter(referArr, (row) => {
        return row[pKey[0].pos].toString() === uKey[0].value;
      })
    }
  }
  return [];
}

function queryPC(address) {
  let postCodeAPI = UrlFetchApp.fetch(appProperties.getProperty('postCodeAPI') + address);
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

function buildSelections(column, referSSID) {
  if(!/C/.test(column.type)) {
    if(/S/.test(column.format)) {
      if(column.content === "") {
        let referSS = SpreadsheetApp.openById(referSSID);
        let referSheet = referSS.getSheets()[0];
        let referRange = referSheet.getDataRange();
        let referArr = referRange.getValues();
        let values = [];
        if(referArr.length > 8) {
          for(let i=8; i<referArr.length; i++) {
            values.push(referArr[i][column.pos].toString());
          }
        }
        return _.join(_.uniq(values), ";");
      }
    }
  }
  return column.content;
}

function getHeaders(referSSID) {
  let referSS = SpreadsheetApp.openById(referSSID);
  let referSheet = referSS.getSheets()[0];
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
          if(formatDetector('S', 'F', obj)) {
            obj.content = buildSelections(obj, referSSID);
          }
          if(formatDetector('L', 'F', obj)) {
            let defaultConfig = [1, 10, 100];
            let userConfig = obj.content.split(";");
            if(userConfig.length === 3) {
              defaultConfig = userConfig;
            }
            obj.content = _.join(defaultConfig, ";");
          }
          if(obj.group !== "") {
            obj.group = obj.group
          }
          headers.push(obj);
        }
      }
    }
  }
  return headers;
}

function authRecord(referSSID, auth) {
  let headers = getHeaders(referSSID);
  for(let i=0; i<auth.length; i++) {
    auth[i].accept = false;
  }
  let gmailFinder = _.filter(headers, (column) => {
    if(/P/.test(column.type)) {
      return /G/.test(column.format);
    }
    return false;
  });
  let userRow = undefined;
  if(gmailFinder.length > 0) {
    let account = Session.getActiveUser().getEmail();
    if(account !== "") {
      gmailFinder[0].value = account;
      userRow = getUserRow(referSSID, [gmailFinder[0]]);
      if(userRow.length > 0) {
        return true;
      }
    }
  } else {
    userRow = getUserRow(referSSID, auth);
    if(userRow.length > 0) {
      let pKey = _.filter(headers, (header) => {
        return /P/.test(header.type);
      });
      if(pKey.length > 0) {
        let uKey = _.filter(auth, (aObj) => {
          return aObj.id === pKey[0].id;
        });
        if(uKey.length > 0) {
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
  }
  return false;
}

function writeRecord(referSSID, recordSSID, auth, record, accept, signatures, email) {
  let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
  let listSheet = listSS.getSheets()[0];
  let listRange = listSheet.getRange("A:O");
  let listArr = listRange.getValues();
  let writeTick = new Date();
  let pureData = [writeTick.getTime(), accept];
  let proceedWrite = true;
  let errorLog = [];
  let primaryData = "";
  let groupData = "";
  let hasGroup = false;
  let result = false;
  let recieved = [];
  let currentSheet = _.filter(listArr, (sheet) => {
    if(sheet[1].toString().trim() === referSSID) {
      if(sheet[2].toString().trim() === recordSSID) {
        return true;
      }
    }
    return false;
  });
  if(currentSheet.length > 0) {
    let now = (new Date()).getTime();
    if(now > parseInt(currentSheet[0][3].toString())) {
      /*if(now < parseInt(currentSheet[0][4].toString())) {
        for(let i=0; i<record.length; i++) {
          record[i].value = record[i].lastInput !== undefined ? record[i].lastInput : record[i].savedContent;
        }
      } else {*/
      proceedWrite = false;
      errorLog.push("表單已過時");
      //}
    }
    if(currentSheet[0][14].toString().trim() === "否") {
      proceedWrite = false;
      errorLog.push("表單關閉，不允許寫入");
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
    let userRows = getUserRow(referSSID, auth);
    if(userRows.length > 0) {
      let userRow = userRows[0];
      for(let i=0; i<record.length; i++) {
        if(proceedWrite) {
          let data = record[i];
          let columns = _.filter(headers, (header) => {
            return header.id === data.id;
          });
          if(columns.length > 0) {
            let column = columns[0];
            if(column.nullable) {
              let emptyFound = false;
              if(/F/.test(column.type)) {
                if(data.value === "") {
                  emptyFound = true;
                }
              }
              if(emptyFound) {
                if(userRow[column.pos].toString() !== "") {
                  proceedWrite = false;
                  errorLog.push(column.name + "原本有資料，你不可以清除！");
                } else {
                  data.value = "不提供資料";
                  proceedWrite = true;
                }
              }
            }
            if(column.must) {
              if(data.value === "") {
                proceedWrite = false;
                errorLog.push(column.name + "必需要有值！");
              } else {
                proceedWrite = true;
              }
            }
            if(formatDetector('', 'C|F', column)) {
              if(proceedWrite) {
                if(data.value !== "不提供資料") {
                  let errorReason = "";
                  if(formatDetector('F', 'F', column)) {
                    column.value = data.value;
                  } else if(formatDetector('L', 'F', column)) {
                    let defaultNum = [1, 10, 100];
                    let numConfig = column.content.split(";");
                    if(numConfig.length === 3) { 
                      defaultNum = _.map(numConfig, (str) => {
                        return parseInt(str);
                      })
                    };
                    if(_.inRange(data.value, defaultNum[1], defaultNum[2]+0.1)) {
                      let diff = data.value - defaultNum[1];
                      if(diff % defaultNum[0] === 0) {
                        column.value = "📝"+parseInt(data.value);
                      } else {
                        errorReason = "數字必須是介於" + defaultNum[1] + "和" + defaultNum[2] + "，每次增減" + defaultNum[0] + "的整數！"
                        proceedWrite = false;
                      }
                    } else {
                      errorReason = "數字必須是介於" + defaultNum[1] + "和" + defaultNum[2] + "，每次增減" + defaultNum[0] + "的整數！"
                      proceedWrite = false;
                    }
                  } else if(formatDetector('N|P', 'F|C', column)) {
                    let numLength = 0;
                    if(formatDetector('P', 'F|C', column)) {
                      let pConfig = column.content.split(";");
                      numLength = parseInt(pConfig[0]);
                    } else if(formatDetector('N', 'F|C', column)) {
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
                  } else if(formatDetector('I', 'F|C', column)) {
                    if(formatDetector('I', 'F', column)) {
                      if(/^[A-Z][0-9|A-Z]\d{8}$/.test(data.value)) {
                        column.value = data.value;
                      } else {
                        proceedWrite = false;
                      }
                    }
                  } else if(formatDetector('E', 'F|C', column)) {
                    if(/^\w+((-\w+)|(\.\w+))*\@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(data.value)) {
                      column.value = data.value;
                    } else {
                      proceedWrite = false;
                    }
                  } else if(formatDetector('M', 'F', column)) {
                    if(/^09\d{8}$/.test(data.value)) {
                      column.value = "📝"+data.value;
                    } else {
                      proceedWrite = false;
                    }
                  } else if(formatDetector('T', 'F|C', column)) {
                    if(column.content === "") {
                      column.value = data.value.replace(/台(北|中|南|灣)/,'臺$1');
                    } else {
                      let regexConfig = column.content.split("::");
                      if(new RegExp(regexConfig[1]).test(data.value)) {
                        column.value = data.value.replace(/台(北|中|南|灣)/,'臺$1');
                      } else {
                        proceedWrite = false;
                      }
                    }
                  } else if(formatDetector('S', 'F|C', column)) {
                    if(new RegExp(data.value).test(column.content)) {
                      column.value = data.value;
                    } else {
                      proceedWrite = false;
                    }
                  } else if(formatDetector('U', 'F|C', column)) {
                    let selectionConfig = column.content.split("::");
                    let selections = _.uniq(selectionConfig[1].split(';'));
                    let selected = _.uniq(data.value.split(';'));
                    let newSelected = [];
                    for(let k=0; k<selected.length; k++) {
                      let checkSelect = _.filter(selections, (selection) => {
                        return selection === selected[k];
                      });
                      if(checkSelect.length > 0) {
                        newSelected.push(checkSelect[0]);
                      }
                    }
                    newSelected = _.uniq(newSelected);
                    if(newSelected.length === selected.length) {
                      column.value = data.value;
                    } else {
                      proceedWrite = false;
                    }
                  }
                  if(!proceedWrite) {
                    errorLog.push(errorReason === "" ? column.name + "格式錯誤！" : column.name + errorReason);
                  }
                }
              }
            } else if(formatDetector('', 'G', column)) {
              if(/G/.test(column.format)) {
                groupData = data.value;
                hasGroup = true;
              }
            } else if(formatDetector('', 'O', column)) {
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
            let groupTest = _.filter(headers, (header) => {
              return header.group === columnGroups[i];
            });
            let gSetting = columnGroups[i].split(":");
            let groupName = gSetting[0];
            let uniqGroup = false;
            if(gSetting.length > 1) {
              if(gSetting[1] === "U") {
                uniqGroup = true;
              }
            }
            if(_.every(groupTest, { group: columnGroups[i], value: "" })) {
              proceedWrite = false;
              errorLog.push("群組欄位「" + groupName + "」不得均為空"); //分組功能未經測試，理想情境是分組可以用中文，然後分號區隔U是否開啟unique
              break;
            }
            if(uniqGroup) {
              let uniqed = _.uniqBy(groupTest, (item) => {
                return item.value.toString().trim();
              });
              if(groupTest.length !== uniqed.length) {
                proceedWrite = false;
                errorLog.push("群組欄位「" + groupName + "」中的欄位值不得重複");
                break;
              }
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
          let signatureIDs = [];
          let csvOutput = "";
          if(currentSheet.length > 0) {
            let savedSignatures = currentSheet[0][6].toString().trim().split(';');
            if(savedSignatures.length > 0) {
              let storageID = appProperties.getProperty('universalStorageID');
              let folder = DriveApp.getFolderById(storageID);
              for(let i=0;i<savedSignatures.length; i++) {
                let signature = _.filter(signatures, (sign) => {
                  return sign.name === savedSignatures[i];
                });
                if(signature.length > 0) {
                  var type = (signature[0].blob.split(";")[0]).replace('data:','');
                  var imageUpload = Utilities.base64Decode(signature[0].blob.split(",")[1]);
                  let blob = Utilities.newBlob(imageUpload,type,savedSignatures[i]);
                  let writtenFile = folder.createFile(blob);
                  csvOutput += "你的簽名("+(i+1)+"/"+savedSignatures.length+")： "+ writtenFile.getUrl() + "\n";
                  writtenFile.setName("[" + writtenFile.getId() + "]" + currentSheet[0][0].toString().trim() + primaryData + "的" + savedSignatures[i] + "簽名");
                  signatureIDs.push(writtenFile.getId());
                }
              }
            }
          }
          pureData.push(_.join(signatureIDs, ";"));
          if(!hasGroup) { groupData = "" }
          pureData.push(groupData);
          for(let i=0; i<headers.length; i++) {
            pureData.push(headers[i].value.toString());
            if(/^\w+((-\w+)|(\.\w+))*\@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(email)) {
              if(/F/.test(headers[i].type)) {
                if(/F/.test(headers[i].format)) {
                  if(headers[i].value !== "") {
                    let file = DriveApp.getFileById(headers[i].value.toString());
                    csvOutput += headers[i].name + " ： " + file.getUrl() + "\n";
                  } else {
                    csvOutput += headers[i].name + " ： 無檔案\n";
                  }
                } else {
                  csvOutput += headers[i].name + " ： " + headers[i].value.toString().replace("📝", "") + "\n";
                }
              }
            }
          }
          let recordSS = SpreadsheetApp.openById(recordSSID);
          let recordSheet = recordSS.getSheets()[0];
          recordSheet.appendRow(pureData);
          result = true;
          if(/^\w+((-\w+)|(\.\w+))*\@[A-Za-z0-9]+((\.|-)[A-Za-z0-9]+)*\.[A-Za-z]+$/.test(email)) {
            if(MailApp.getRemainingDailyQuota() > 0) {
              let now = new Date();
              let replyEmail = currentSheet[0][12].toString().trim();
              let systemTitle = appProperties.getProperty('systemTitle');
              let emailSSID = appProperties.getProperty('emailLog');
              let formTitle = currentSheet[0][0].toString().trim();
              MailApp.sendEmail(email, replyEmail, systemTitle + "填寫結果回條","您好：感謝您填寫表單「" + formTitle + "」，你的填寫時間是" + writeTick.toLocaleString() + "\n以下是你的填寫結果\n" + csvOutput + "\n任何問題，請回信至：" + replyEmail);
              let emailSS = SpreadsheetApp.openById(emailSSID);
              let emailSheet = emailSS.getSheets()[0];
              emailSheet.appendRow([now.getTime(), formTitle, primaryData,email]);
            }
          }
        }
      }
      for(let i=0; i<headers.length; i++) {
        headers[i].pos = undefined;
      }
      recieved = headers
    } else {
      errorLog.push("你原本可以填這張表嗎？");
    }
  }
  return {
    status: result,
    errorLog: errorLog,
    data: recieved,
    tick: writeTick.getTime()
  };
}

function saveFile(referSSID, recordSSID, auth, columnID, fileObj) {
  let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
  let listSheet = listSS.getSheets()[0];
  let listRange = listSheet.getRange("A:O");
  let listArr = listRange.getValues();
  let proceedWrite = true;
  let errorLog = [];
  let fileID = "";
  let fileURL = "";
  let currentSheet = _.filter(listArr, (sheet) => {
    if(sheet[1].toString().trim() === referSSID) {
      if(sheet[2].toString().trim() === recordSSID) {
        return true;
      }
    }
    return false;
  });
  if(currentSheet.length > 0) {
    let now = (new Date()).getTime();
    if(now > parseInt(currentSheet[0][3].toString())) {
      /*if(now < parseInt(currentSheet[0][4].toString())) {
        for(let i=0; i<record.length; i++) {
          record[i].value = record[i].lastInput !== undefined ? record[i].lastInput : record[i].savedContent;
        }
      } else {*/
      proceedWrite = false;
      errorLog.push("表單已過時");
      //}
    }
  }
  if(proceedWrite) {
    let headers = getHeaders(referSSID);
    let columns = _.filter(headers, (header) => {
      return header.id === columnID;
    });
    if(columns.length > 0) {
      let column = columns[0];
      if(/F/.test(column.type)) {
        if(/F/.test(column.format)) {
          let storageID = appProperties.getProperty('universalStorageID');
          let maxSize = 1;
          let mimeLimit = "";
          if(column.content !== "") {
            let contentConfig = column.content.split(";");
            if(contentConfig[2] !== "") { maxSize = parseInt(contentConfig[2]); }
            if(contentConfig[1] !== "") { mimeLimit = contentConfig[1]; }
            if(contentConfig[3] !== "") { storageID = contentConfig[3]; }
          }
          if((new RegExp(mimeLimit, "i")).test(fileObj.mimeType)) {
            let blob = Utilities.newBlob(fileObj.bytes, fileObj.mimeType, fileObj.filename);
            if(fileObj.bytes.length <= maxSize * 1000000) {
              let folder = DriveApp.getFolderById(storageID);
              let writtenFile = folder.createFile(blob); 
              writtenFile.setName("[" + writtenFile.getId() + "]" + currentSheet[0][0].toString().trim() + fileObj.filename);
              fileID = writtenFile.getId();
              fileURL = writtenFile.getUrl();
            } else {
              proceedWrite = false;
              errorLog.push("檔案大小超過" + maxSize + "MB限制");
            }
          } else {
            proceedWrite = false;
            errorLog.push("檔案格式限定為" + mimeLimit + "類型");
          }
        } else {
          proceedWrite = false;
          errorLog.push("你確定這個欄位可以寫入？");
        }
      } else {
        proceedWrite = false;
        errorLog.push("你確定這個欄位可以寫入？");
      }
    }
  } else {
    errorLog.push("你原本可以填這張表嗎？");
  }
  return {
    status: proceedWrite,
    errorLog: errorLog,
    fileID: fileID,
    fileURL: fileURL
  };
}

function duplicateSubmits(recordSSID, qPkey) {
  let recordSS = SpreadsheetApp.openById(recordSSID);
  let recordSheet = recordSS.getSheets()[0];
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
  let recordSheet = recordSS.getSheets()[0];
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
  let recordSheet = recordSS.getSheets()[0];
  let recordRange = recordSheet.getDataRange();
  let recordArr = recordRange.getValues();
  let referSS = SpreadsheetApp.openById(referSSID);
  let referSheet = referSS.getSheets()[0];
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
      let groupNos = _.filter(groupColumns, (header) => {
        return /N/.test(header.format);
      });
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
            return record[4].toString().trim() === groups[i].toString();
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
          let returnList = "";
          if(unfinished.length === referCount.length) {
            returnList = "全體均未填寫";
          }
          if(unfinished.length === 0) {
            returnList = "已完成";
          }
          if(returnList === "") {
            if(groupNos.length > 0) {
              let temp = [];
              for(let k=0; k<unfinished.length; k++) {
                let nos = _.filter(referTemp, (row) => {
                  return row[pkeyColumns[0].pos].toString() === unfinished[k];
                });
                if(nos.length > 0) {
                  temp.push(nos[0][groupNos[0].pos].toString());
                }
              }
              returnList = temp.join(",") + " (" + unfinished.length + "/" + referCount.length + ")";
            } else {
              if(unfinished.length <= 3) {
                let temp = [];
                for(let k=0; k<unfinished.length; k++) {
                  temp.push(maskString(unfinished[k].toString()));
                }
                returnList = temp.join(",");
              } else if(unfinished.length > 3) {
                returnList = unfinished.length + "/" + referCount.length + "（超過3人不顯示名單）";
              }
            }
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

function getScriptURL() {
  return ScriptApp.getService().getUrl();
}

function formatDetector(format, type, column) {
  if((new RegExp(type)).test(column.type)) {
    if((new RegExp(format)).test(column.format)) {
      return true;
    }
  }
  return false;
}