export const API_ROUTES = ['/api/status', '/api/catalog', '/api/catalog-meta', '/api/benefit', '/api/analyze', '/api/recommend', '/api/client-events'];
export const CLIENT_EVENTS = ['javascript_error', 'unhandled_rejection', 'react_error', 'network_error', 'invalid_response', 'catalogue_error', 'detail_error'];
export const safeRoute = value => API_ROUTES.includes(String(value).split('?')[0]) ? String(value).split('?')[0] : 'unknown';

export const ERROR_TYPES = ['Error', 'TypeError', 'SyntaxError', 'RangeError', 'ReferenceError', 'URIError', 'EvalError', 'AbortError', 'TimeoutError'];
