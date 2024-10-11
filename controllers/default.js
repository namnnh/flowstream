const { publish } = require("total5/tms");

exports.install = function () {
  ROUTE("+GET /", index);
  ROUTE("+GET /companies/{company_id}/sites", sites);
  ROUTE("+GET /sites/{site_id}/areas", areas);
  ROUTE("+GET /sites/{site_id}/areas/{area_id}", areasEditor);
  ROUTE("+GET /flow", flow);
  ROUTE("+GET /designer/");
  ROUTE("-GET /", login);
};

function flow($) {
  if ($.user.openplatform && !$.user.iframe && $.query.openplatform) {
    $.cookie(CONF.op_cookie, $.query.openplatform, NOW.add("12 hours"));
    $.redirect($.url);
    return;
  }

  var plugins = [];
  var hostname = $.hostname();

  if (CONF.url !== hostname) CONF.url = hostname;

  for (var key in F.plugins) {
    var item = F.plugins[key];
    if (!item.visible || item.visible($.user)) {
      var obj = {};
      obj.id = item.id;
      obj.position = item.position;
      obj.name = TRANSLATE($.user.language || "", item.name);
      obj.icon = item.icon;
      obj.import = item.import;
      obj.routes = item.routes;
      obj.hidden = item.hidden;
      plugins.push(obj);
    }
  }

  $.view("flow/index", plugins);
}

function login($) {
  if (CONF.op_reqtoken && CONF.op_restoken) $.fallback(401);
  else $.view("login");
}

function index($) {
  var hostname = $.hostname();

  if (CONF.url !== hostname) CONF.url = hostname;

  $.view("index");
}

async function sites($) {
  let companyId = $.params.company_id;
  let companyData = await DATA.read("op.company").id(companyId).promise();
  var hostname = $.hostname();

  if (CONF.url !== hostname) CONF.url = hostname;

  $.view("sites/index", companyData);
}
function areasEditor($) {
  $.view("flow/area_flow");
}
async function areas($) {
  let siteId = $.params.site_id;
  let siteData = await DATA.read("op.site").id(siteId).promise();
  let companyData = await DATA.read("op.company")
    .id(siteData.company_id)
    .promise();
  var hostname = $.hostname();
  var plugins = [];

  for (var key in F.plugins) {
    var item = F.plugins[key];
    if (!item.visible || item.visible($.user)) {
      var obj = {};
      obj.id = item.id;
      obj.position = item.position;
      obj.name = TRANSLATE($.user.language || "", item.name);
      obj.icon = item.icon;
      obj.import = item.import;
      obj.routes = item.routes;
      obj.hidden = item.hidden;
      plugins.push(obj);
    }
  }

  if (CONF.url !== hostname) CONF.url = hostname;
  $.view("flow/index", { site: siteData, company: companyData, plugins });
}
