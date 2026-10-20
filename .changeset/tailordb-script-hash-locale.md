---
"@tailor-platform/sdk": patch
---

Stop `tailor deploy` from reporting `Table '<name>' scripts differ between remote and snapshot` when machines with different system locales deploy the same schema. The TailorDB script hash ordered field names by the machine's default locale (for example, Czech sorts `ch` after `h`), so the same schema could hash differently and fail the deploy with remote schema drift. Hashes from en-US, ja-JP and C locales are unchanged. A table with scripts that was last deployed from a locale that orders its field names differently from English (for example cs-CZ, sk-SK, lt-LT or et-EE) may report this drift after upgrading, because the hash stored on the remote was computed in that locale's order.
