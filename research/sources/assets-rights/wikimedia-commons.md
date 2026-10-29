# Wikimedia Commons API (retrieved 2026-10-29)
URL: https://commons.wikimedia.org/w/api.php?action=query&titles=File:X&prop=imageinfo&iiprop=extmetadata|url|size&format=json
Live test returned extmetadata keys: LicenseShortName, UsageTerms, AttributionRequired, LicenseUrl, Copyrighted, Artist, Credit, ImageDescription, Restrictions.
Example: "LicenseShortName":"CC BY-SA 4.0","AttributionRequired":"true","Copyrighted":"True".
Note: file title File:Migrant_Mother.jpg is NOT the Dorothea Lange photo (it is a CC BY-SA sculpture photo): title-based lookups can hit wrong files; verify.
Search: https://api.wikimedia.org/core/v1/commons/search/page?q=apollo+11&limit=1 works without auth.
