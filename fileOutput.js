function renameAndCopyFiles() {
    var startTime = new Date();
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = spreadsheet.getSheetByName('更名機器人'); 
    
    var outputFolderId = sheet.getRange('A4').getValue();
    
    var dataRange = sheet.getRange('B2:C' + sheet.getLastRow());
    var data = dataRange.getValues();
    
    var outputFolder = DriveApp.getFolderById(outputFolderId);
    
    var renamedCount = 0;
    
    for (var i = 0; i < data.length; i++) {
      var fileUrl = data[i][0];
      var targetString = data[i][1];
      
      var fileId = getFileIdFromUrl(fileUrl);
      if (fileId !== "") {
        var file = DriveApp.getFileById(fileId);
        var newName = targetString;
        
        file.makeCopy(newName, outputFolder);
        
        renamedCount++;
        
        var newFile = outputFolder.getFilesByName(newName).next();
        var fileLink = newFile.getUrl();
        
        sheet.getRange(i + 2, 4).setValue(fileLink); 
      }
    }
    
    var endTime = new Date();
    var executionTime = (endTime - startTime) / 1000;
    
    var message = "更名執行結束，你要求更改 " + data.length + " 個檔案，已找到 " + renamedCount + " 個檔案，執行時間為 " + executionTime + " 秒";
    SpreadsheetApp.getUi().alert(message);
  }
  
  function getFileIdFromUrl(url) {
    var regex = /[-\w]{25,}/;
    var match = url.match(regex);
    if (match) {
      return match[0];
    } else {
      return "";
    }
  }
  