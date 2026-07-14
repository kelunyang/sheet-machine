// 哨兵字串的單一來源。系統裡共三個哨兵，語意互不相通（詳見 plan/issue.md「三個哨兵各司其職」）：
//
//   「無資料」          D 欄位（noneable）使用者主動宣告——前端有按鈕、原樣落地、回填原樣保留
//   「不提供資料」      N 欄位（nullable）留空的落地形式——純伺服器端，前端不認識它
//   REUSE_LAST_FILE   檔案欄「沿用上次上傳的檔案」——**傳輸層指令，絕不落地**
//
// REUSE_LAST_FILE 的設計要點（Phase 23）：前端帶入舊檔時只把它塞進 column.value，**前端沒有
// 傳舊 fileID 的通道**；後端 writeRecord 遇到它才從該使用者紀錄表最後一列查出真 fileID 替換進
// pureData，查無就整筆擋下。刻意選機器味字串與兩個中文哨兵視覺分家。
// 字面值必須與 src/Code.js 的 REUSE_LAST_FILE_SENTINEL 一致（tests/fieldSources.test.js 讀源鎖定）。
export const REUSE_LAST_FILE = '__SM_REUSE_LAST_FILE__';
