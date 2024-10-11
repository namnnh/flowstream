NEWSCHEMA(
  "@Company",
  "name:String,namespace:String,icon:string,color:string,address:string"
);

NEWACTION("Company/create", {
  name: "Create Company",
  input: "@Company",
  action: async function ($, model) {
    model.id = UID();
    await DATA.insert("op.company", model).promise($);
    $.success(model.id);
  },
});
NEWACTION("Company/list", {
  name: "List of Companies",
  action: function ($) {
    var builder = DATA.list("op.company");
    builder.autoquery(
      $.query,
      "name,namespace,color,icon,address,id",
      "dtupdated_desc",
      100
    );
    builder.callback($);
  },
});
