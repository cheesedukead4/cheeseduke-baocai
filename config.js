/*
 * 選填：把 Apps Script 網頁應用程式網址填在這裡，同事開啟「雲端同步設定」時就會自動帶入，
 * 只需要輸入團隊通行碼。通行碼請勿寫在這個檔案裡（網站檔案任何人都看得到）。
 */
/*
 * Google 登入：填入 Google Cloud「OAuth 用戶端 ID」（網頁應用程式類型）就會啟用，開啟 App 要先用 Google 帳號登入，
 * 只有管理員加進名單的 Gmail 能讀寫資料。用戶端 ID 是公開資訊，可以放在這裡。留空＝沿用舊的團隊通行碼模式。
 * 雲端後端（雲端後端/Code.gs）也要填同一個 ID 並執行 setupAuth()，詳見「使用說明」的「Google 登入」一節。
 */
window.CMS_AUTH = {
  clientId: ''
};

window.CMS_CLOUD_PRESET = {
  url: 'https://script.google.com/macros/s/AKfycbxFP1UdQC81xIUrXS8EIFwCMiwLgBTOPII3MDgxsEzEgoTEH4RqQ-7l4yN5y2mTXvgC/exec'
};
