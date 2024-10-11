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