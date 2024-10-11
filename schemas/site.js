NEWSCHEMA(
  "@Site",
  "name:String,namespace:String,icon:string,color:string,company_id:string"
);

NEWACTION("Site/create", {
  name: "Create Site",
  input: "@Site",
  action: async function ($, model) {
    model.id = UID();
    await DATA.insert("op.site", model).promise($);
    $.success(model.id);
  },
});
NEWACTION("Site/list", {
  name: "List of Sites",
  action: function ($) {
    var builder = DATA.list("op.site");
    builder.autoquery(
      $.query,
      "name,namespace,color,icon,company_id,id",
      "dtupdated_desc",
      100
    );
    builder.callback($);
  },
});
