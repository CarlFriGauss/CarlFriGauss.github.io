// A separate www redirect keeps ordinary static requests on the free asset service.
export default {
  fetch(request) {
    const target = new URL(request.url);
    target.protocol = 'https:';
    target.hostname = 'carlfriedrichgauss.com';
    target.port = '';
    return Response.redirect(target.toString(), 308);
  }
};
