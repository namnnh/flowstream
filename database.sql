---------------------------------------
-- TABLES
---------------------------------------

CREATE SCHEMA op;

---------------------------------------
-- TABLES
---------------------------------------

CREATE TABLE "op"."company" (
	"id" text NOT NULL,
	"namespace" text,
	"name" text,
	"icon" text,
	"color" text,
    "address" text,
	"dtupdated" timestamp DEFAULT now(),
	PRIMARY KEY ("id")
);

CREATE TABLE "op"."site" (
    "id" text NOT NULL,
    "company_id" text NOT NULL,
    "namespace" text,
    "name" text,
    "icon" text,
    "color" text,
    "dtupdated" timestamp DEFAULT now(),
    PRIMARY KEY ("id"),
    CONSTRAINT fk_company
        FOREIGN KEY ("company_id")
        REFERENCES "op"."company"("id")
        ON DELETE CASCADE
);
CREATE TABLE "op"."deployment_services" (
    "id" text NOT NULL,
    "area_id" text NOT NULL,
    "component_id" text NOT NULL,
    "deployment_id" text NOT NULL,
    "deployment_status" text,
    "deployment_links" jsonb,
    "deployment_actions" jsonb,
    "deployment_type" text,
    "dtupdated" timestamp DEFAULT now(),
    PRIMARY KEY ("id")
);