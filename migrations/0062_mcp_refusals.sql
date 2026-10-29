CREATE TABLE hiring_mcp_refusals (message TEXT NOT NULL CHECK(json_extract('{}',message) IS NULL));
