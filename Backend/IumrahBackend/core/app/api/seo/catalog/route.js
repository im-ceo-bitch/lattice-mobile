import {loadSeoCatalog} from '../../../../lib/seo/store.js';
export async function GET(){const {groups,known}=await loadSeoCatalog();return Response.json({groups:[...groups],known:[...known]},{headers:{'cache-control':'no-store','x-robots-tag':'noindex'}});}
