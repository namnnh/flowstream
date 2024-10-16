const { action } = require("total5/builders");
const axios = require("axios");
const https = require("https");

const DB_FILE_FLOW = "database.json";
const DIRECTORY_FLOW = CONF.directory || PATH.root("flows");

function skip(key, value) {
  return key === "unixsocket" || key === "env" ? undefined : value;
}

const Fields =
  "id,name:SafeString,author,version,icon:Icon,reference,group,url,cloning:Boolean,color:Color,readme,memory:Number,proxypath".toJSONSchema();
// ************************    DEFINE FUNCTION    ****************************
function findComponentsByName(data, componentName) {
  const components = [];
  for (const key in data) {
    if (data[key].component === componentName) {
      components.push(data[key]);
    }
  }

  return components;
}

function initRancherApi(rancherServer) {
  const { url, apiVersion, token, server_id } = rancherServer.config;
  const fullUrl = `${url}/${apiVersion}/project/${server_id}`;
  const axiosInstance = axios.create({
    baseURL: fullUrl,
    headers: {
      Authorization: `Bearer ${token}`,
    },
    httpsAgent: new https.Agent({
      rejectUnauthorized: false,
    }),
  });

  return axiosInstance;
}
async function deployMqttComponent(axiosInstance, mqttComponent, $) {
  const { docker_image, containerPort, name, replica } = mqttComponent.config;
  let payload = null;
  const port = containerPort;
  const brokerName = name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .trim();
  let existedDeployment = await DATA.find("op.deployment_services")
    .where("component_id", mqttComponent.id)
    .where("deployment_status", "successful")
    .promise($);
  if (existedDeployment.length === 0) {
    //Deploy MQTT config
    const configMapPayload = {
      type: "configMap",
      name: "mosquitto-config",
      namespaceId: "main-app",
      data: {
        "mosquitto.conf": `
listener ${port}
socket_domain ipv4
allow_anonymous true
`,
      },
    };
    //Deploy MQTT Service
    const servicePayload = {
      type: "service",
      name: `${brokerName}-service`,
      namespaceId: "main-app",
      selector: {
        app: `${brokerName}-mqtt`,
      },
      kind: "ClusterIP",
      ports: [
        {
          name: "mqtt",
          port: port,
          protocol: "TCP",
          targetPort: port,
        },
        {
          name: "mqttssl",
          port: 8883,
          protocol: "TCP",
          targetPort: 8083,
        },
        {
          name: "dashboard",
          port: 18083,
          protocol: "TCP",
          targetPort: 18083,
        },
      ],
    };
    const workloadPayload = {
      name: `${brokerName}-mqtt`,
      namespaceId: "main-app",
      containers: [
        {
          name: `${brokerName}-mqtt`,
          image: docker_image,
          restart: "no",
          container_name: `${brokerName}-mqtt`,
          replicas: replica,
          selector: {
            matchLabels: {
              app: `${brokerName}-mqtt`,
            },
          },
          ports: [
            {
              containerPort: port,
              protocol: "TCP",
            },
            {
              containerPort: 8083,
              protocol: "TCP",
            },
            {
              containerPort: 18083,
              protocol: "TCP",
            },
          ],
          volumeMounts: [
            {
              mountPath: "/mosquitto/config/mosquitto.conf",
              name: "mosquitto-config",
              readOnly: false,
              subPath: "mosquitto.conf",
            },
          ],
          imagePullPolicy: "Always",
        },
      ],
      volumes: [
        {
          configMap: {
            name: "mosquitto-config",
          },
          name: "mosquitto-config",
        },
      ],
      serviceAccountName: "default",
    };
    await axiosInstance
      .post("/configmaps", configMapPayload)
      .then(async (res) => {
        if (res.data) {
          await axiosInstance
            .post("/services", servicePayload)
            .then(async (res) => {
              if (res.data) {
                await axiosInstance
                  .post("/workloads", workloadPayload)
                  .then((res) => {
                    payload = res.data;
                    console.log(
                      "Success calling Rancher API to deploy MQTT workloads"
                    );
                  })
                  .catch((error) => {
                    $.invalid(
                      "@(Error when calling Rancher API to deploy MQTT workloads)"
                    );
                  });
              }
            })
            .catch((error) => {
              $.invalid(
                "@(Error when calling Rancher API to deploy MQTT services)"
              );
            });
        }
      })
      .catch((error) => {
        $.invalid("@(Error when calling Rancher API to deploy MQTT config)");
      });
  }
  return { brokerName, brokerPort: port, payload };
}
async function deployPrinterComponent(
  axiosInstance,
  printerComponent,
  brokerUrl,
  $
) {
  const { docker_image, printer_name, subscribe_topic, containerPort } =
    printerComponent.config;
  let payload = null;
  const printerNameFormat = printer_name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .trim();
  const printerName =
    printerNameFormat +
    "-" +
    F.TUtils.random_string(10)
      .toLowerCase()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .trim();
  const workloadPayload = {
    name: printerName,
    namespaceId: "main-app",
    containers: [
      {
        name: printerName,
        image: docker_image,
        restart: "no",
        container_name: printerName,
        replicas: 1,
        selector: {
          matchLabels: {
            app: printerName,
          },
        },
        env: [
          {
            name: "MQTT_BROKER_URL",
            value: brokerUrl,
          },
          {
            name: "MQTT_CHANNEL",
            value: subscribe_topic,
          },
          {
            name: "PRINTER_NAME",
            value: printer_name,
          },
        ],
        ports: [
          {
            name: `${printerNameFormat}-port`,
            containerPort: containerPort,
          },
        ],
        imagePullPolicy: "Always",
      },
    ],
  };
  await axiosInstance
    .post("/workloads", workloadPayload)
    .then((res) => {
      payload = res.data;
      console.log("Success calling Rancher API to deploy Printer Service");
    })
    .catch((error) => {
      $.invalid("@(Error when calling Rancher API to deploy Printer Service)");
    });

  return payload;
}
async function deployScannerComponent(
  axiosInstance,
  scannerComponent,
  brokerUrl,
  $
) {
  const { docker_image, scanner_name, public_topic, containerPort } =
    scannerComponent.config;
  let payload = null;
  const scannerNameFormat = scanner_name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .trim();
  const scannerName =
    scannerNameFormat +
    "-" +
    F.TUtils.random_string(10)
      .toLowerCase()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .trim();
  const workloadPayload = {
    name: scannerName,
    namespaceId: "main-app",
    containers: [
      {
        name: scannerName,
        image: docker_image,
        restart: "no",
        container_name: scannerName,
        replicas: 1,
        selector: {
          matchLabels: {
            app: scannerName,
          },
        },
        env: [
          {
            name: "MQTT_BROKER_URL",
            value: brokerUrl,
          },
          {
            name: "MQTT_CHANNEL",
            value: public_topic,
          },
          {
            name: "SCANNER_NAME",
            value: scanner_name,
          },
        ],
        ports: [
          {
            name: `${scannerNameFormat}-port`,
            containerPort: containerPort,
          },
        ],
        imagePullPolicy: "Always",
      },
    ],
  };
  await axiosInstance
    .post("/workloads", workloadPayload)
    .then((res) => {
      payload = res.data;
      console.log("Success calling Rancher API to deploy Scanner Service");
    })
    .catch((error) => {
      $.invalid("@(Error when calling Rancher API to deploy Scanner Service)");
    });

  return payload;
}
async function deployFlowStream(
  axiosInstance,
  flowStreamComponent,
  brokerName,
  brokerPort,
  $
) {
  const { subscribe_topic, port, name } = flowStreamComponent.config;
  let payload = null;
  let nameFormat = name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .trim();
  let nameFlow =
    nameFormat +
    "-" +
    F.TUtils.random_string(10)
      .toLowerCase()
      .toLowerCase()
      .replace(/[\s_]+/g, "-")
      .trim();

  const filePath = PATH.join(DIRECTORY_FLOW, DB_FILE_FLOW);
  PATH.fs.readFile(filePath, "utf8", async (err, data) => {
    let jsonData = JSON.parse(data);
    const firstKey = Object.keys(jsonData).find((key) => key !== "variables");
    const design = jsonData[firstKey].design;
    let mqttSubscribeObject = null;
    let mqttBrokerObject = null;

    for (let key in design) {
      if (design[key].component === "mqttsubscribe") {
        mqttSubscribeObject = design[key];
        break;
      }
    }
    for (let key in design) {
      if (design[key].component === "mqttbroker") {
        mqttBrokerObject = design[key];
        break;
      }
    }

    if (mqttSubscribeObject) {
      mqttSubscribeObject.config.topic = subscribe_topic;
    }
    if (mqttBrokerObject) {
      mqttBrokerObject.config.host = `${brokerName}-mqtt`;
      mqttBrokerObject.config.port = brokerPort;
      mqttBrokerObject.config.name = `[MQTT] ${mqttBrokerObject.config.host}:${brokerPort}`;
    }
    const configPayload = {
      type: "configMap",
      name: `${nameFormat}-config`,
      namespaceId: "main-app",
      data: {
        "database.json": JSON.stringify(jsonData, skip, "\t"),
      },
    };
    await axiosInstance
      .post("/configmaps", configPayload)
      .then(async (res) => {
        if (res.data) {
          const workloadPayload = {
            name: nameFlow,
            namespaceId: "main-app",
            containers: [
              {
                name: nameFlow,
                image: "totalplatform/flow",
                restart: "no",
                container_name: nameFlow,
                replicas: 1,
                selector: {
                  matchLabels: {
                    app: nameFlow,
                  },
                },
                ports: [
                  {
                    name: `flow-port`,
                    containerPort: port,
                  },
                ],
                volumeMounts: [
                  {
                    mountPath: "/www/flowstream/database.json",
                    name: `${nameFormat}-config`,
                    readOnly: false,
                    subPath: "database.json",
                  },
                ],
                imagePullPolicy: "Always",
              },
            ],
            volumes: [
              {
                configMap: {
                  name: `${nameFormat}-config`,
                },
                name: `${nameFormat}-config`,
              },
            ],
            serviceAccountName: "default",
          };
          await axiosInstance
            .post("/workloads", workloadPayload)
            .then((res) => {
              payload = res.data;
              console.log(
                "Success calling Rancher API to deploy MQTT FlowStream workloads"
              );
            })
            .catch((error) => {
              $.invalid(
                "@(Error when calling Rancher API to deploy MQTT FlowStream workloads)"
              );
            });
        }
      })
      .catch((error) => {
        $.invalid(
          "@(Error when calling Rancher API to deploy FlowStream configmaps)"
        );
      });
  });

  return payload;
}
// ************************    END DEFINE FUNCTION    ****************************

NEWACTION("Streams/query", {
  name: "Query streams",
  action: function ($) {
    let siteId = $.query.siteId;
    var arr = [];
    for (var key in Flow.db) {
      if (key !== "variables") {
        var item = Flow.db[key];
        if (siteId && item.siteId !== siteId) {
          continue;
        }
        var instance = Flow.instances[key];
        arr.push({
          id: item.id,
          name: item.name,
          group: item.group,
          author: item.author,
          reference: item.reference,
          url: item.url,
          color: item.color,
          icon: item.icon,
          readme: item.readme,
          dtcreated: item.dtcreated,
          dtupdated: item.dtupdated,
          errors: false,
          size: item.size || 0,
          version: item.version,
          proxypath: item.proxypath
            ? CONF.default_root
              ? CONF.default_root + item.proxypath.substring(1)
              : item.proxypath
            : "",
          memory: item.memory,
          stats: instance ? instance.flow.stats : {},
        });
      }
    }
    $.callback(arr);
  },
});

NEWACTION("Streams/read", {
  name: "Read specific stream",
  params: "*id",
  action: function ($) {
    var id = $.params.id;
    var item = Flow.db[id];
    if (item) {
      var data = {};
      for (let key in Fields.properties) data[key] = item[key];
      if (data.cloning == null) data.cloning = true;
      $.callback(data);
    } else $.invalid(404);
  },
});

NEWACTION("Streams/save", {
  name: "Save specific stream",
  input: Fields,
  action: function ($, model) {
    var init = !model.id;

    if (init) {
      if (UNAUTHORIZED($, "create")) return;
    }

    var db = Flow.db;

    if (model.proxypath) {
      if (model.proxypath[0] !== "/") model.proxypath = "/" + model.proxypath;

      if (model.proxypath[model.proxypath.length - 1] !== "/")
        model.proxypath += "/";

      var ignore = [
        "/",
        "/cdn/",
        "/fapi/",
        "/private/",
        "/flows/",
        "/designer/",
        "/parts/",
        "/forms/",
        "/css/",
        "/js/",
        "/fonts/",
        "/panels/",
      ];

      if (ignore.includes(model.proxypath)) {
        $.invalid("@(Proxy endpoint contains reserved path)");
        return;
      }

      for (var key in db) {
        if (db[key].proxypath === model.proxypath && key !== model.id) {
          $.invalid(
            'Proxy endpoint is already used by the "{0}" Flow.'.format(
              db[key].name
            )
          );
          return;
        }
      }
    }

    if (init) {
      model.id = "f" + UID();
      model.design = {};
      model.components = {};
      model.variables = {};
      model.sources = {};
      model.dtcreated = NOW;
      model.asfiles = CONF.flowstream_asfiles === true;
      model.worker = CONF.flowstream_worker;
      model.variables2 = Flow.db.variables || {};
      model.directory = CONF.directory || PATH.root("/flowstream/");
      model.env = PREF.env || "dev";

      if (!model.memory) model.memory = CONF.flowstream_memory || 0;

      TRANSFORM("flowstream.create", model, function (err, model) {
        Flow.db[model.id] = model;
        Flow.load(model, ERROR("FlowStream.init"));
      });
    } else {
      var item = Flow.db[model.id];
      if (item) {
        item = CLONE(item);
        item.dtupdated = NOW;
        item.name = model.name;
        item.icon = model.icon;
        item.url = model.url;
        item.version = model.version;
        item.reference = model.reference;
        item.author = model.author;
        item.group = model.group;
        item.color = model.color;
        item.memory = model.memory;
        item.cloning = model.cloning;
        item.isDeploy = model.isDeploy;
        item.readme = model.readme;
        item.proxypath = model.proxypath;

        TRANSFORM("flowstream.update", item, function (err, item) {
          Flow.reload(item);
        });
      } else {
        $.invalid(404);
        return;
      }
    }

    $.audit();
    $.success();

    Flow.emit("save");
  },
});

NEWACTION("Streams/remove", {
  name: "Remoce specific stream",
  permissions: "remove",
  params: "*id:String",
  action: function ($) {
    var id = $.params.id;
    var item = Flow.db[id];
    if (item) {
      var path = CONF.directory
        ? CONF.directory
        : "~" + PATH.root("flowstream");
      if (path[0] === "~") path = path.substring(1);
      else path = PATH.root(CONF.directory);

      F.Fs.rm(PATH.join(path, id), { recursive: true, force: true }, NOOP);
      Flow.remove(id);
      Flow.emit("save");

      $.audit(item.name);
      $.success();
    } else $.invalid(404);
  },
});

NEWACTION("Streams/raw", {
  name: "Read stream raw data",
  params: "*id",
  action: function ($) {
    var item = Flow.db[$.params.id];
    if (item) $.callback(item);
    else $.invalid(404);
  },
});

var internalstats = {};
internalstats.node = F.version_node;
internalstats.total = F.version;
internalstats.version = Flow.version;

NEWACTION("Streams/stats", {
  name: "Read stats",
  action: function ($) {
    internalstats.messages = 0;
    internalstats.pending = 0;
    internalstats.mm = 0;
    internalstats.memory = process.memoryUsage().heapUsed;

    internalstats.online = 0;

    for (let key in Total.connections)
      internalstats.online += Total.connections[key].online;

    for (let key in Flow.instances) {
      let flow = Flow.instances[key];
      if (flow.flow && flow.flow.stats) {
        internalstats.messages += flow.flow.stats.messages;
        internalstats.mm += flow.flow.stats.mm;
        internalstats.pending += flow.flow.stats.pending;
      }
    }

    $.callback(internalstats);
  },
});

NEWACTION("Streams/pause", {
  name: "Pause a specific stream",
  params: "*id",
  action: function ($) {
    var id = $.params.id;
    var item = Flow.db[id];
    if (item) {
      var is = $.query.is ? $.query.is === "1" : null;
      var instance = Flow.instances[id];
      if (instance) {
        if (instance.flow.stats && is != null) instance.flow.stats.paused = is;
        instance.pause(is);
        $.audit();
        $.success();
      } else $.invalid("@(Instance is not running)");
    } else $.invalid(404);
  },
});

NEWACTION("Streams/restart", {
  name: "Restart a specific stream",
  params: "*id",
  action: function ($) {
    var id = $.params.id;
    if (Flow.restart(id)) $.success();
    else $.invalid(404);
  },
});

NEWACTION("Streams/deploy", {
  name: "Restart a specific stream",
  params: "*id",
  action: async function ($) {
    var id = $.params.id;
    var item = Flow.db[id];
    if (item) {
      const design = item.design;
      const rancherComponents = findComponentsByName(design, "rancher");
      if (rancherComponents.length > 0) {
        let rancherServer = rancherComponents[0];
        const axiosInstance = initRancherApi(rancherServer);
        //Delete Deployment not exist in template
        let existedPrinterDeployment = await DATA.find("op.deployment_services")
          .fields("component_id,deployment_links")
          .where("area_id", id)
          .promise($);
        const missingComponents = existedPrinterDeployment.filter(
          (item) => !design.hasOwnProperty(item.component_id)
        );
        for (let component of missingComponents) {
          console.log("Component", component);
          await axiosInstance
            .delete(component.deployment_links.remove)
            .then(async (res) => {
              await DATA.remove("op.deployment_services").where(
                "component_id",
                component.component_id
              );
              console.log(`Delete success ${component.component_id}`);
            })
            .catch(() => {
              $.invalid("@(Error deleting component_id)");
            });
        }
        //end;
        const mqttComponents = findComponentsByName(design, "mqttbrokerdeploy");

        if (mqttComponents.length > 0) {
          let mqttComponent = mqttComponents[0];
          let { brokerName, brokerPort, payload } = await deployMqttComponent(
            axiosInstance,
            mqttComponent,
            $
          );
          if (payload) {
            let model = {
              id: UID(),
              area_id: id,
              component_id: mqttComponent.id,
              deployment_id: payload.uuid,
              deployment_status: "successful",
              deployment_links: JSON.stringify(payload.links),
              deployment_actions: JSON.stringify(payload.actions),
              deployment_type: payload.type,
            };
            await DATA.insert("op.deployment_services", model).promise($);
          }

          if (brokerName && brokerPort) {
            const brokerUrl = `mqtt://${brokerName}-mqtt:${brokerPort}`;
            const printerComponents = findComponentsByName(
              design,
              "printer_service"
            );
            if (printerComponents.length > 0) {
              for (const p of printerComponents) {
                let existedPrinterDeployment = await DATA.find(
                  "op.deployment_services"
                )
                  .where("component_id", p.id)
                  .where("deployment_status", "successful")
                  .promise($);

                if (existedPrinterDeployment.length === 0) {
                  let printerPayload = await deployPrinterComponent(
                    axiosInstance,
                    p,
                    brokerUrl,
                    $
                  );
                  if (printerPayload) {
                    let model = {
                      id: UID(),
                      area_id: id,
                      component_id: p.id,
                      deployment_id: printerPayload.uuid,
                      deployment_status: "successful",
                      deployment_links: JSON.stringify(printerPayload.links),
                      deployment_actions: JSON.stringify(
                        printerPayload.actions
                      ),
                      deployment_type: printerPayload.type,
                    };
                    await DATA.insert("op.deployment_services", model).promise(
                      $
                    );
                  }
                }
              }
            }

            const scannerComponents = findComponentsByName(design, "Scanner");
            if (scannerComponents.length > 0) {
              for (const p of scannerComponents) {
                let existedScannerDeployment = await DATA.find(
                  "op.deployment_services"
                )
                  .where("component_id", p.id)
                  .where("deployment_status", "successful")
                  .promise($);

                if (existedScannerDeployment.length === 0) {
                  let scannerPayload = await deployScannerComponent(
                    axiosInstance,
                    p,
                    brokerUrl,
                    $
                  );
                  if (scannerPayload) {
                    let model = {
                      id: UID(),
                      area_id: id,
                      component_id: p.id,
                      deployment_id: scannerPayload.uuid,
                      deployment_status: "successful",
                      deployment_links: JSON.stringify(scannerPayload.links),
                      deployment_actions: JSON.stringify(
                        scannerPayload.actions
                      ),
                      deployment_type: scannerPayload.type,
                    };
                    await DATA.insert("op.deployment_services", model).promise(
                      $
                    );
                  }
                }
              }
            }

            const flowstreamComponents = findComponentsByName(
              design,
              "flowstream"
            );
            if (flowstreamComponents.length > 0) {
              let flowstreamComponent = flowstreamComponents[0];
              let existedFlowsDeploymentRecord = await DATA.find(
                "op.deployment_services"
              )
                .where("component_id", flowstreamComponent.id)
                .where("deployment_status", "successful")
                .promise($);
              if (existedFlowsDeploymentRecord.length === 0) {
                const payloadFlowDeploy = await deployFlowStream(
                  axiosInstance,
                  flowstreamComponent,
                  brokerName,
                  brokerPort,
                  $
                );
                if (payloadFlowDeploy) {
                  let model = {
                    id: UID(),
                    area_id: id,
                    component_id: flowstreamComponent.id,
                    deployment_id: payloadFlowDeploy.uuid,
                    deployment_status: "successful",
                    deployment_links: JSON.stringify(payloadFlowDeploy.links),
                    deployment_actions: JSON.stringify(
                      payloadFlowDeploy.actions
                    ),
                    deployment_type: payloadFlowDeploy.type,
                  };
                  await DATA.insert("op.deployment_services", model).promise($);
                }
              }
            }
          }
        }
      }
    } else $.invalid(404);

    $.success();
  },
});
