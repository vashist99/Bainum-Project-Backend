/** Tag requests on `/api/schools` so controllers use school nomenclature in JSON keys. */
export function schoolApiMount(req, _res, next) {
    req.useSchoolsNomenology = true;
    next();
}
