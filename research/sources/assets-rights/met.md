# Met Museum Open Access API (retrieved 2026-10-29)
URL: https://metmuseum.github.io/
- "we do not require API users to register or obtain an API key... limit request rate to 80 requests per second."
- NOTICE: "/public/collection/v1/search endpoint is deprecated and will be retired on October 1, 2026... migrate to /v1.1" (today is after that date; live test of /v1.1/search?q=sunflowers&hasImages=true returned {"total":153,"objectIDs":[...]}).
- Object JSON has isPublicDomain, primaryImage (original), primaryImageSmall. Only isPublicDomain=true objects are CC0.
