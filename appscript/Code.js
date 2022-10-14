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
  let listRange = listSheet.getRange("A:K");
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
            viewDate: parseInt(row[4].toString().trim()),
            enableModify: row[5].toString().trim() === "否" ? false : true,
            signatures: row[6].toString() === "" ? [] : row[6].toString().trim().split(";"),
            comment: row[7].toString().trim(),
            loginTip: row[8].toString().trim(),
            submitTip: row[9].toString().trim(),
            loginfailTip: row[10].toString().trim()
          })
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

function readRecord(referSSID, recordSSID, auth) {
  if(authRecord(referSSID, auth)) {
    let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
    let listSheet = listSS.getSheets()[0];
    let listRange = listSheet.getRange("A:K");
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
                          column.lastInput = "";
                        }
                      } else {
                        column.lastInput = "";
                      }
                    } else {
                      column.lastInput = "";
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
              signatures: signatures,
              headers: headers
            };
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
          if(!/C/.test(obj.type)) {
            if(/S/.test(obj.format)) {
              obj.content = buildSelections(obj, referSSID);
            }
          }
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
  let userRow = getUserRow(referSSID, auth);
  if(userRow.length > 0) {
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

function writeRecord(referSSID, recordSSID, auth, record, accept, signatures) {
  let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
  let listSheet = listSS.getSheets()[0];
  let listRange = listSheet.getRange("A:K");
  let listArr = listRange.getValues();
  let writeTick = (new Date()).getTime();
  let pureData = [writeTick, accept];
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
            if(/F|C/.test(column.type)) {
              if(proceedWrite) {
                if(data.value !== "不提供資料") {
                  let errorReason = "";
                  if(/F/.test(column.format)) {
                    if(/F/.test(column.type)) {
                      column.value = data.value;
                    }
                  } else if(/N|P/.test(column.format)) {
                    let numLength = 0;
                    if(/P/.test(column.format)) {
                      let pConfig = column.content.split(";");
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
                      if(/^[A-Z][0-9|A-Z]\d{8}$/.test(data.value)) {
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
                    errorLog.push(errorReason === "" ? column.name + "格式錯誤！" : column.name + errorReason);
                  }
                }
              }
            } else if(/G/.test(column.type)) {
              if(/G/.test(column.format)) {
                groupData = data.value;
                hasGroup = true;
              }
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
            if(_.every(groupTest, { group: columnGroups[i], value: "" })) {
              proceedWrite = false;
              errorLog.push("第" + columnGroups[i] + "群組欄位不得均為空");
              break;
            }
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
          let signatureIDs = [];
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
          }
          let recordSS = SpreadsheetApp.openById(recordSSID);
          let recordSheet = recordSS.getSheets()[0];
          recordSheet.appendRow(pureData);
          result = true;
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
    tick: writeTick
  };
}

function saveFile(referSSID, recordSSID, auth, columnID, fileObj) {
  let listSS = SpreadsheetApp.openById(appProperties.getProperty('listSheetID'));
  let listSheet = listSS.getSheets()[0];
  let listRange = listSheet.getRange("A:K");
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
            if(contentConfig[2] !== "") { maxSize = parseInt(contentConfig[1]); }
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