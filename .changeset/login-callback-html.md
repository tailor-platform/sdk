---
"@tailor-platform/sdk": patch
---

`tailor login` now shows an HTML page in the browser after authentication instead of raw JSON, with a close button, telling you to close the tab and return to the terminal. The page follows the system light/dark theme. A failed login shows the reason in the page as well, and `tailor authconnection authorize` shows the same pages on success and failure.
