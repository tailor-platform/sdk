---
"@tailor-platform/sdk": patch
---

`tailor login` now shows an HTML page in the browser after authentication instead of raw JSON, telling you to close the tab and return to the terminal. A failed login shows the reason in the page as well, and `tailor authconnection authorize` shows the same page on success.
