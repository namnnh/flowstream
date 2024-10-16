const axios = require("axios");
const https = require("https");

const DB_FILE = "database.json";
const DIRECTORY = CONF.directory || PATH.root("flowstream");

const DB_FILE_FLOW = "database.json";
const DIRECTORY_FLOW = CONF.directory || PATH.root("flows");

CONF.$customtitles = true;

PATH.mkdir(DIRECTORY);
PATH.mkdir(PATH.private());

function skip(key, value) {
  return key === "unixsocket" || key === "env" ? undefined : value;
}

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

function deployPrinterComponent(axiosInstance, printerComponent, brokerUrl) {
  const { docker_image, printer_name, public_topic, containerPort } =
    printerComponent.config;
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
            value: public_topic,
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
  axiosInstance
    .post("/workloads", workloadPayload)
    .then((res) => {
      console.log("Success calling Rancher API to deploy Printer Service");
    })
    .catch((error) => {
      console.error(
        "Error when calling Rancher API to deploy Printer Service",
        error
      );
    });
}

function deployMqttComponent(axiosInstance, mqttComponent) {
  const { docker_image, port, broker_name } = mqttComponent.config;
  const brokerName = broker_name
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .trim();
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
        replicas: 1,
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
  axiosInstance
    .post("/configmaps", configMapPayload)
    .then((res) => {
      if (res.data) {
        axiosInstance
          .post("/services", servicePayload)
          .then((res) => {
            if (res.data) {
              axiosInstance
                .post("/workloads", workloadPayload)
                .then((res) => {
                  console.log(
                    "Success calling Rancher API to deploy MQTT workloads"
                  );
                })
                .catch((error) => {
                  console.error(
                    "Error when calling Rancher API to deploy MQTT workloads"
                  );
                });
            }
          })
          .catch((error) => {
            console.error(
              "Error when calling Rancher API to deploy MQTT services"
            );
          });
      }
    })
    .catch((error) => {
      console.error("Error when calling Rancher API to deploy MQTT config");
    });

  return { brokerName, brokerPort: port };
}

function deployFlowStream(
  axiosInstance,
  flowStreamComponent,
  brokerName,
  brokerPort
) {
  const { subscribe_topic, port, name } = flowStreamComponent.config;
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
  PATH.fs.readFile(filePath, "utf8", (err, data) => {
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
    axiosInstance
      .post("/configmaps", configPayload)
      .then((res) => {
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
          axiosInstance
            .post("/workloads", workloadPayload)
            .then((res) => {
              console.log(
                "Success calling Rancher API to deploy MQTT FlowStream workloads"
              );
            })
            .catch((error) => {
              console.error(
                "Error when calling Rancher API to deploy MQTT FlowStream workloads",
                error
              );
            });
        }
      })
      .catch((error) => {
        console.error(
          "Error when calling Rancher API to deploy FlowStream configmaps",
          error
        );
      });
  });
}

async function deployServices(data) {
  const rancherComponents = findComponentsByName(data, "rancher");

  if (rancherComponents.length > 0) {
    let rancherServer = rancherComponents[0];
    const axiosInstance = initRancherApi(rancherServer);
    const mqttComponents = findComponentsByName(data, "mqtt_broker_deploy");
    if (mqttComponents.length > 0) {
      let mqttComponent = mqttComponents[0];
      let { brokerName, brokerPort } = await deployMqttComponent(
        axiosInstance,
        mqttComponent
      );
      if (brokerName && brokerPort) {
        const brokerUrl = `mqtt://${brokerName}-mqtt:${brokerPort}`;
        const printerComponents = findComponentsByName(data, "printer_service");
        if (printerComponents.length > 0) {
          for (const p of printerComponents) {
            await deployPrinterComponent(axiosInstance, p, brokerUrl);
          }
        }
        const flowstreamComponents = findComponentsByName(data, "flowstream");
        if (flowstreamComponents.length > 0) {
          let flowstreamComponent = flowstreamComponents[0];
          await deployFlowStream(
            axiosInstance,
            flowstreamComponent,
            brokerName,
            brokerPort
          );
        }
      }
    }
  }
}

Flow.on("save", async function ($) {
  for (var key in Flow.db) {
    if (key !== "variables") {
      var flow = Flow.db[key];
      if (flow.isDeploy) {
        deployServices(flow.design);
      }
      flow.size = Buffer.byteLength(JSON.stringify(flow));
    }
  }

  if (CONF.backup) {
    PATH.fs.rename(
      PATH.join(DIRECTORY, DB_FILE),
      PATH.join(
        DIRECTORY,
        DB_FILE.replace(/\.json/, "") +
          "_" +
          new Date().format("yyyyMMddHHmm") +
          ".bk"
      ),
      function () {
        PATH.fs.writeFile(
          PATH.join(DIRECTORY, DB_FILE),
          JSON.stringify(Flow.db, skip, "\t"),
          ERROR("FlowStream.save")
        );
      }
    );
  } else PATH.fs.writeFile(PATH.join(DIRECTORY, DB_FILE), JSON.stringify(Flow.db, skip, "\t"), ERROR("FlowStream.save"));
});

function init(id, next) {
  var flow = Flow.db[id];

  flow.variables2 = Flow.db.variables || {};
  flow.directory = CONF.directory || PATH.root("/flowstream/");
  flow.sandbox = CONF.flowstream_sandbox == true;
  flow.env = PREF.env || "dev";

  if (!flow.memory) flow.memory = CONF.flowstream_memory || 0;

  flow.asfiles = CONF.flowstream_asfiles === true;
  flow.worker = CONF.flowstream_worker;
  flow.paused = true;

  Flow.load(flow, function (err, instance) {
    next();
  });
}

ON("init", function () {
  PATH.fs.readFile(PATH.join(DIRECTORY, DB_FILE), function (err, data) {
    Flow.db = data ? data.toString("utf8").parseJSON(true) : {};

    if (!Flow.db.variables) Flow.db.variables = {};

    Object.keys(Flow.db).wait(function (key, next) {
      if (key === "variables") next();
      else init(key, next);
    });
  });
});
