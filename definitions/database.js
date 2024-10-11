require("querybuilderpg").init(
  "",
  CONF.database,
  CONF.pooling || 1,
  ERROR("PostgreSQL")
);

async function init() {
  console.log("Running Database");
  var op_tables = await DATA.query(
    "SELECT FROM pg_tables WHERE schemaname='op' LIMIT 1"
  ).promise();
  if (op_tables.length) {
    PAUSESERVER("Database");
    return;
  }
  // DB is empty
  F.Fs.readFile(PATH.root("database.sql"), async function (err, buffer) {
    var data = {};

    // Temporary
    CONF.welcome = true;

    var sql = buffer.toString("utf8").arg(data);

    // Run SQL
    await DATA.query(sql).promise();

    PAUSESERVER("Database");
  });
}
PAUSESERVER("Database");

setTimeout(init, 3000);
