-- Squashed baseline migration — replaces the historical 65-file chain.
-- Built from a schema-only pg_dump of the fully-migrated DB (so it
-- includes the hand-authored schemas index.ts does NOT re-export:
-- inspection / coaching / training / purchase / *_evacuation / shade / vsla).
-- Extensions are prepended (pg_dump omits them under --schema filters).
-- Trailing INSERTs seed integration.sync_settings (Kobo scheduler config
-- that the TS seed layer does not recreate).
CREATE EXTENSION IF NOT EXISTS postgis;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pgcrypto;
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6 (Debian 17.6-1.pgdg12+1)
-- Dumped by pg_dump version 17.6 (Debian 17.6-1.pgdg12+1)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA audit;


--
-- Name: coaching; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA coaching;


--
-- Name: farmer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA farmer;


--
-- Name: field_ops; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA field_ops;


--
-- Name: gis; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA gis;


--
-- Name: iam; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA iam;


--
-- Name: inspection; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA inspection;


--
-- Name: integration; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA integration;


--
-- Name: primary_evacuation; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA primary_evacuation;


--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: purchase; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA purchase;


--
-- Name: reference; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA reference;


--
-- Name: reporting; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA reporting;


--
-- Name: secondary_evacuation; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA secondary_evacuation;


--
-- Name: shade; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA shade;


--
-- Name: traceability; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA traceability;


--
-- Name: training; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA training;


--
-- Name: vsla; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA vsla;


--
-- Name: notify_audit_event(); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.notify_audit_event() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  PERFORM pg_notify('audit_events', json_build_object(
    'id',            NEW.id,
    'resource',      audit.resource_from_entity_table(NEW.entity_table),
    'cooperativeId', NEW.cooperative_id,
    'actorUserId',   NEW.actor_user_id
  )::text);
  RETURN NEW;
END
$$;


--
-- Name: resource_from_entity_table(text); Type: FUNCTION; Schema: audit; Owner: -
--

CREATE FUNCTION audit.resource_from_entity_table(t text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
  SELECT CASE t
    WHEN 'farmers'           THEN 'farmer'
    WHEN 'parcels'           THEN 'parcel'
    WHEN 'inspections'       THEN 'inspection'
    WHEN 'trainings'         THEN 'training'
    WHEN 'training_sessions' THEN 'training'
    WHEN 'coaching_visits'   THEN 'coaching'
    WHEN 'cocoa_purchases'   THEN 'purchase'
    WHEN 'lots'              THEN 'primary_evac'
    WHEN 'batches'           THEN 'batch'
    WHEN 'eudr_assessments'  THEN 'eudr'
    WHEN 'cooperatives'      THEN 'cooperative'
    WHEN 'users'             THEN 'user'
    WHEN 'roles'             THEN 'role'
    WHEN 'permissions'       THEN 'permission'
    WHEN 'sync_jobs'         THEN 'sync'
    WHEN 'sync_settings'     THEN 'sync'
    WHEN 'report_runs'       THEN 'report'
  END
$$;


--
-- Name: notify_projection_invalidate(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.notify_projection_invalidate() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  payload JSONB;
  coop_id UUID;
BEGIN
  BEGIN
    IF TG_OP = 'DELETE' THEN
      coop_id := (to_jsonb(OLD)->>'cooperative_id')::UUID;
    ELSE
      coop_id := (to_jsonb(NEW)->>'cooperative_id')::UUID;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    coop_id := NULL;
  END;

  payload := jsonb_build_object(
    'schema', TG_TABLE_SCHEMA,
    'table',  TG_TABLE_NAME,
    'op',     TG_OP,
    'cooperative_id', coop_id,
    'at',     extract(epoch from NOW())
  );

  PERFORM pg_notify('projection_invalidate', payload::text);
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: audit_attachment; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.audit_attachment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    audit_log_id bigint NOT NULL,
    filename text NOT NULL,
    mime_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sha256 text NOT NULL,
    storage_backend text DEFAULT 'local'::text NOT NULL,
    storage_key text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.audit_logs (
    id bigint NOT NULL,
    actor_user_id uuid,
    service_name text,
    entity_schema text NOT NULL,
    entity_table text NOT NULL,
    entity_id text,
    action text NOT NULL,
    cooperative_id uuid,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: audit; Owner: -
--

CREATE SEQUENCE audit.audit_logs_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: audit; Owner: -
--

ALTER SEQUENCE audit.audit_logs_id_seq OWNED BY audit.audit_logs.id;


--
-- Name: report_audit_logs; Type: TABLE; Schema: audit; Owner: -
--

CREATE TABLE audit.report_audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_run_id uuid,
    actor_user_id uuid,
    report_code text NOT NULL,
    parameters jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coaching_visits; Type: TABLE; Schema: coaching; Owner: -
--

CREATE TABLE coaching.coaching_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kobo_uuid text NOT NULL,
    kobo_id bigint NOT NULL,
    form_version text NOT NULL,
    cooperative_id uuid,
    farmer_id text,
    parcel_id text,
    coach_name text,
    visit_date date NOT NULL,
    district text,
    society text,
    clmrs_risk_level text,
    clmrs_case_id text,
    children_observed_working boolean,
    num_children_in_household smallint,
    gap_score smallint,
    ipm_score smallint,
    gep_score smallint,
    gsp_score smallint,
    overall_score smallint,
    gep_no_deforestation boolean,
    n_chemical_apps smallint DEFAULT 0 NOT NULL,
    n_fertilizer_apps smallint DEFAULT 0 NOT NULL,
    n_weeding_acts smallint DEFAULT 0 NOT NULL,
    n_pruning_acts smallint DEFAULT 0 NOT NULL,
    n_harvest_acts smallint DEFAULT 0 NOT NULL,
    n_other_acts smallint DEFAULT 0 NOT NULL,
    follow_up_required boolean DEFAULT false NOT NULL,
    follow_up_date date,
    raw_data jsonb NOT NULL,
    submitted_at timestamp with time zone NOT NULL,
    submitted_by text,
    snapshot_url text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT coaching_visits_clmrs_check CHECK (((clmrs_risk_level IS NULL) OR (clmrs_risk_level = ANY (ARRAY['no_risk'::text, 'at_risk'::text, 'case'::text]))))
);


--
-- Name: farmer_photos; Type: TABLE; Schema: farmer; Owner: -
--

CREATE TABLE farmer.farmer_photos (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id text NOT NULL,
    storage_key text NOT NULL,
    file_name text,
    mime_type text,
    captured_at timestamp with time zone,
    uploaded_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: farmers; Type: TABLE; Schema: farmer; Owner: -
--

CREATE TABLE farmer.farmers (
    id text NOT NULL,
    cooperative_id uuid NOT NULL,
    external_source text,
    producer_id text,
    first_name text NOT NULL,
    last_name text NOT NULL,
    other_names text,
    sex text,
    date_of_birth date,
    phone_number text,
    national_id_number text,
    certification_status text DEFAULT 'unknown'::text NOT NULL,
    registration_date date,
    household_size smallint,
    children_count smallint,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    national_id_type text,
    society text,
    data_collection_consent boolean,
    hh_assessed boolean,
    shade_survival_pct numeric(5,2),
    kobo_id bigint,
    CONSTRAINT farmers_children_count_check CHECK ((children_count >= 0)),
    CONSTRAINT farmers_household_size_check CHECK ((household_size >= 0)),
    CONSTRAINT farmers_sex_check CHECK ((sex = ANY (ARRAY['male'::text, 'female'::text, 'other'::text, 'unknown'::text])))
);


--
-- Name: household_members; Type: TABLE; Schema: farmer; Owner: -
--

CREATE TABLE farmer.household_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id text NOT NULL,
    full_name text NOT NULL,
    relationship_to_farmer text,
    sex text,
    date_of_birth date,
    phone_number text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT household_members_sex_check CHECK ((sex = ANY (ARRAY['male'::text, 'female'::text, 'other'::text, 'unknown'::text])))
);


--
-- Name: profile_change_history; Type: TABLE; Schema: farmer; Owner: -
--

CREATE TABLE farmer.profile_change_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id text NOT NULL,
    changed_by_user_id uuid,
    field_name text NOT NULL,
    old_value jsonb,
    new_value jsonb,
    changed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coaching_reports; Type: TABLE; Schema: field_ops; Owner: -
--

CREATE TABLE field_ops.coaching_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    coaching_visit_id uuid NOT NULL,
    progress_summary text,
    next_steps text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: coaching_visits; Type: TABLE; Schema: field_ops; Owner: -
--

CREATE TABLE field_ops.coaching_visits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id text NOT NULL,
    cooperative_id uuid NOT NULL,
    coach_user_id uuid,
    visit_date date,
    attendees_count integer,
    summary text,
    actions_agreed text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid
);


--
-- Name: farm_development_plans; Type: TABLE; Schema: field_ops; Owner: -
--

CREATE TABLE field_ops.farm_development_plans (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id text NOT NULL,
    cooperative_id uuid NOT NULL,
    created_by_user_id uuid,
    status text DEFAULT 'draft'::text NOT NULL,
    plan_notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT fdp_status_check CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'completed'::text, 'cancelled'::text])))
);


--
-- Name: follow_up_actions; Type: TABLE; Schema: field_ops; Owner: -
--

CREATE TABLE field_ops.follow_up_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid,
    farmer_id text NOT NULL,
    cooperative_id uuid NOT NULL,
    assigned_to_user_id uuid,
    action_type text NOT NULL,
    description text,
    due_date date,
    status text DEFAULT 'open'::text NOT NULL,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT follow_up_status_check CHECK ((status = ANY (ARRAY['open'::text, 'in_progress'::text, 'done'::text, 'cancelled'::text])))
);


--
-- Name: inspection_findings; Type: TABLE; Schema: field_ops; Owner: -
--

CREATE TABLE field_ops.inspection_findings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id uuid NOT NULL,
    requirement_code text NOT NULL,
    severity text NOT NULL,
    finding_status text DEFAULT 'open'::text NOT NULL,
    notes text,
    ra_indicator_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT findings_severity_check CHECK ((severity = ANY (ARRAY['minor'::text, 'major'::text, 'critical'::text]))),
    CONSTRAINT findings_status_check CHECK ((finding_status = ANY (ARRAY['open'::text, 'resolved'::text, 'waived'::text])))
);


--
-- Name: inspections; Type: TABLE; Schema: field_ops; Owner: -
--

CREATE TABLE field_ops.inspections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    farmer_id text NOT NULL,
    cooperative_id uuid NOT NULL,
    inspection_year integer NOT NULL,
    inspection_date date,
    inspector_user_id uuid,
    compliance_status text,
    score numeric(5,2),
    certification_status text,
    source_submission_uuid text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid
);


--
-- Name: training_attendance; Type: TABLE; Schema: field_ops; Owner: -
--

CREATE TABLE field_ops.training_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    farmer_id text NOT NULL,
    attendance_status text NOT NULL,
    recorded_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT attendance_status_check CHECK ((attendance_status = ANY (ARRAY['attended'::text, 'absent'::text, 'excused'::text])))
);


--
-- Name: training_modules; Type: TABLE; Schema: field_ops; Owner: -
--

CREATE TABLE field_ops.training_modules (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cooperative_id uuid,
    title text NOT NULL,
    description text,
    objectives text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid
);


--
-- Name: training_sessions; Type: TABLE; Schema: field_ops; Owner: -
--

CREATE TABLE field_ops.training_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    module_id uuid NOT NULL,
    cooperative_id uuid NOT NULL,
    facilitator_user_id uuid,
    session_date date,
    location text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid
);


--
-- Name: eudr_status; Type: TABLE; Schema: gis; Owner: -
--

CREATE TABLE gis.eudr_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parcel_id text NOT NULL,
    status text DEFAULT 'unknown'::text NOT NULL,
    assessed_at timestamp with time zone,
    assessed_by text,
    baseline_dataset text,
    qgis_job_ref text,
    notes text,
    country_risk_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    overlap text,
    on_land text,
    in_country text,
    deforestation_risk text,
    protected_area_risk text,
    eudr_data text,
    eudr_explanation text,
    CONSTRAINT eudr_status_check CHECK ((status = ANY (ARRAY['unknown'::text, 'compliant'::text, 'non_compliant'::text, 'needs_review'::text])))
);


--
-- Name: geo_import_jobs; Type: TABLE; Schema: gis; Owner: -
--

CREATE TABLE gis.geo_import_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_format text NOT NULL,
    source_file_name text,
    status text DEFAULT 'pending'::text NOT NULL,
    processed_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT gij_source_check CHECK ((source_format = ANY (ARRAY['geojson'::text, 'kml'::text, 'kmz'::text, 'shapefile'::text, 'manual'::text, 'qgis'::text]))),
    CONSTRAINT gij_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: parcel_characteristics; Type: TABLE; Schema: gis; Owner: -
--

CREATE TABLE gis.parcel_characteristics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parcel_id text NOT NULL,
    soil_type text,
    irrigation_type text,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    shade_trees_total integer,
    shade_tree_species text,
    shade_tree_seedlings integer,
    shade_trees_young integer,
    shade_trees_matured integer,
    shade_tree_arrangement text[],
    shade_tree_seedling_source text,
    CONSTRAINT shade_tree_seedlings_check CHECK (((shade_tree_seedlings IS NULL) OR (shade_tree_seedlings >= 0))),
    CONSTRAINT shade_trees_matured_check CHECK (((shade_trees_matured IS NULL) OR (shade_trees_matured >= 0))),
    CONSTRAINT shade_trees_total_check CHECK (((shade_trees_total IS NULL) OR (shade_trees_total >= 0))),
    CONSTRAINT shade_trees_young_check CHECK (((shade_trees_young IS NULL) OR (shade_trees_young >= 0)))
);


--
-- Name: parcel_geometries; Type: TABLE; Schema: gis; Owner: -
--

CREATE TABLE gis.parcel_geometries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parcel_id text NOT NULL,
    import_job_id uuid,
    source_format text,
    captured_at timestamp with time zone,
    geom public.geometry(MultiPolygon,4326),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    point_geom public.geometry(Point,4326)
);


--
-- Name: parcel_overlap_flags; Type: TABLE; Schema: gis; Owner: -
--

CREATE TABLE gis.parcel_overlap_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    parcel_id text NOT NULL,
    nearby_parcel_id text NOT NULL,
    distance_meters numeric(10,2),
    status text DEFAULT 'flagged'::text NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT overlap_status_check CHECK ((status = ANY (ARRAY['flagged'::text, 'reviewed'::text, 'dismissed'::text])))
);


--
-- Name: parcels; Type: TABLE; Schema: gis; Owner: -
--

CREATE TABLE gis.parcels (
    id text NOT NULL,
    farmer_id text NOT NULL,
    cooperative_id uuid NOT NULL,
    parcel_name text,
    parcel_status text DEFAULT 'active'::text NOT NULL,
    crop_type text,
    planting_date date,
    cocoa_tree_count integer,
    calculated_area_ha numeric(10,4),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    cocoa_variety text,
    tree_spacing text,
    nearby_feature_type text,
    willing_to_rehabilitate boolean,
    land_ownership_type text,
    shade_survival_pct numeric(5,2),
    CONSTRAINT parcels_cocoa_tree_count_check CHECK (((cocoa_tree_count IS NULL) OR (cocoa_tree_count >= 0))),
    CONSTRAINT parcels_cocoa_variety_check CHECK (((cocoa_variety IS NULL) OR (cocoa_variety = ANY (ARRAY['hybrid'::text, 'amazon'::text, 'amelonado'::text, 'other'::text])))),
    CONSTRAINT parcels_nearby_feature_check CHECK (((nearby_feature_type IS NULL) OR (nearby_feature_type = ANY (ARRAY['road'::text, 'river'::text, 'hamlet'::text, 'forest_reserve'::text, 'other'::text])))),
    CONSTRAINT parcels_ownership_check CHECK (((land_ownership_type IS NULL) OR (land_ownership_type = ANY (ARRAY['owned'::text, 'family'::text, 'sharecropped'::text, 'leased'::text, 'communal'::text, 'other'::text])))),
    CONSTRAINT parcels_status_check CHECK ((parcel_status = ANY (ARRAY['active'::text, 'inactive'::text, 'archived'::text])))
);


--
-- Name: accounts; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cooperatives; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.cooperatives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    district_code text,
    district_name text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    description text,
    chair_user_id uuid,
    contact_email public.citext,
    contact_phone text,
    address text
);


--
-- Name: permissions; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.permissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: role_permissions; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.roles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sessions; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    token text NOT NULL,
    ip_address text,
    user_agent text,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_cooperative_assignments; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.user_cooperative_assignments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    cooperative_id uuid NOT NULL,
    assignment_scope text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT uca_scope_check CHECK ((assignment_scope = ANY (ARRAY['district'::text, 'all_districts'::text])))
);


--
-- Name: user_notification_pref; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.user_notification_pref (
    user_id uuid NOT NULL,
    resource text NOT NULL,
    disabled_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_roles; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.user_roles (
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    assigned_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: users; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email public.citext NOT NULL,
    email_verified boolean DEFAULT false NOT NULL,
    full_name text NOT NULL,
    image text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    default_cooperative_id uuid,
    last_login_at timestamp with time zone,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    is_all_cooperative boolean DEFAULT false NOT NULL,
    CONSTRAINT users_status_check CHECK ((status = ANY (ARRAY['active'::text, 'inactive'::text, 'locked'::text])))
);


--
-- Name: verifications; Type: TABLE; Schema: iam; Owner: -
--

CREATE TABLE iam.verifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: attachments; Type: TABLE; Schema: inspection; Owner: -
--

CREATE TABLE inspection.attachments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id bigint NOT NULL,
    kobo_uid text NOT NULL,
    question_xpath text NOT NULL,
    filename text,
    mimetype text,
    kobo_url text,
    spaces_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: corrective_actions; Type: TABLE; Schema: inspection; Owner: -
--

CREATE TABLE inspection.corrective_actions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    inspection_id bigint,
    farmer_id text,
    parcel_id text,
    cooperative_id uuid,
    date_inspection date,
    topic text NOT NULL,
    action text NOT NULL,
    action_date date,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    source text DEFAULT 'inspection'::text NOT NULL,
    coaching_visit_id uuid,
    last_comment text,
    CONSTRAINT corrective_actions_one_source_check CHECK ((num_nonnulls(inspection_id, coaching_visit_id) = 1)),
    CONSTRAINT corrective_actions_source_check CHECK ((source = ANY (ARRAY['inspection'::text, 'coaching'::text]))),
    CONSTRAINT corrective_actions_status_check CHECK ((status = ANY (ARRAY['open'::text, 'reopen'::text, 'processing'::text, 'done'::text])))
);


--
-- Name: inspections; Type: TABLE; Schema: inspection; Owner: -
--

CREATE TABLE inspection.inspections (
    id bigint NOT NULL,
    kobo_uuid text NOT NULL,
    form_version text NOT NULL,
    cooperative_id uuid,
    farmer_id text,
    parcel_id text,
    date_inspection date NOT NULL,
    inspector_code text,
    eudr_status text,
    eudr_score smallint,
    eudr_no_deforestation boolean,
    eudr_no_forest_conversion boolean,
    eudr_outside_hcva boolean,
    eudr_legal_rights boolean,
    eudr_assessed_at timestamp with time zone,
    compliance_score smallint,
    compliance_max smallint,
    compliance_pct numeric(5,2),
    raw_data jsonb NOT NULL,
    submitted_at timestamp with time zone NOT NULL,
    submitted_by text,
    snapshot_url text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    program_year integer,
    certification_outcome text,
    CONSTRAINT inspections_certification_outcome_check CHECK (((certification_outcome IS NULL) OR (certification_outcome = ANY (ARRAY['certified'::text, 'certified_with_ca'::text, 'not_certified'::text, 'disqualified'::text])))),
    CONSTRAINT inspections_eudr_status_check CHECK (((eudr_status IS NULL) OR (eudr_status = ANY (ARRAY['unknown'::text, 'compliant'::text, 'non_compliant'::text, 'needs_review'::text])))),
    CONSTRAINT inspections_program_year_check CHECK (((program_year IS NULL) OR ((program_year >= 1) AND (program_year <= 5))))
);


--
-- Name: attachment_link; Type: TABLE; Schema: integration; Owner: -
--

CREATE TABLE integration.attachment_link (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    attachment_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    caption text,
    linked_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_by_user_id uuid,
    CONSTRAINT attachment_link_entity_type_check CHECK ((entity_type = ANY (ARRAY['farmer'::text, 'inspection'::text, 'inspection_finding'::text, 'training_session'::text, 'coaching_visit'::text, 'farm_development_plan'::text, 'parcel'::text])))
);


--
-- Name: kobo_attachment; Type: TABLE; Schema: integration; Owner: -
--

CREATE TABLE integration.kobo_attachment (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    kobo_asset_uid text NOT NULL,
    question_xpath text NOT NULL,
    mime_type text NOT NULL,
    filename text NOT NULL,
    size_bytes bigint,
    sha256 text,
    storage_url text,
    downloaded_at timestamp with time zone,
    download_error text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: kobo_submissions_raw; Type: TABLE; Schema: integration; Owner: -
--

CREATE TABLE integration.kobo_submissions_raw (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    form_code text NOT NULL,
    submission_uuid text NOT NULL,
    cooperative_id uuid,
    payload jsonb,
    submitted_at timestamp with time zone,
    synced_at timestamp with time zone,
    processing_status text DEFAULT 'pending'::text NOT NULL,
    error_message text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kobo_raw_status_check CHECK ((processing_status = ANY (ARRAY['pending'::text, 'processed'::text, 'failed'::text, 'ignored'::text])))
);


--
-- Name: kobo_validation_errors; Type: TABLE; Schema: integration; Owner: -
--

CREATE TABLE integration.kobo_validation_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_key text NOT NULL,
    kobo_uuid text NOT NULL,
    form_version text,
    field_path text NOT NULL,
    code text NOT NULL,
    message text NOT NULL,
    severity text DEFAULT 'error'::text NOT NULL,
    received jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT kobo_validation_errors_severity_check CHECK ((severity = ANY (ARRAY['error'::text, 'warning'::text])))
);


--
-- Name: migration_jobs; Type: TABLE; Schema: integration; Owner: -
--

CREATE TABLE integration.migration_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_system text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    summary jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT migration_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: reconciliation_results; Type: TABLE; Schema: integration; Owner: -
--

CREATE TABLE integration.reconciliation_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    migration_job_id uuid NOT NULL,
    entity_name text NOT NULL,
    source_count integer,
    target_count integer,
    mismatch_count integer,
    details jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_cursors; Type: TABLE; Schema: integration; Owner: -
--

CREATE TABLE integration.sync_cursors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_system text NOT NULL,
    source_key text NOT NULL,
    last_cursor text,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_errors; Type: TABLE; Schema: integration; Owner: -
--

CREATE TABLE integration.sync_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sync_job_id uuid,
    source_reference text,
    error_message text,
    payload jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_jobs; Type: TABLE; Schema: integration; Owner: -
--

CREATE TABLE integration.sync_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_system text NOT NULL,
    job_type text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    started_at timestamp with time zone,
    finished_at timestamp with time zone,
    processed_count integer DEFAULT 0 NOT NULL,
    failed_count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT sync_jobs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: sync_settings; Type: TABLE; Schema: integration; Owner: -
--

CREATE TABLE integration.sync_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_key text NOT NULL,
    label text NOT NULL,
    source_url text NOT NULL,
    field_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    auto_sync_enabled boolean DEFAULT false NOT NULL,
    interval_minutes integer DEFAULT 1440 NOT NULL,
    last_run_at timestamp with time zone,
    last_run_status text,
    last_run_summary jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    snapshot_hash text,
    snapshot_uploaded_at timestamp with time zone,
    last_query_at timestamp with time zone,
    description text,
    CONSTRAINT sync_settings_interval_check CHECK ((interval_minutes >= 1)),
    CONSTRAINT sync_settings_status_check CHECK (((last_run_status IS NULL) OR (last_run_status = ANY (ARRAY['running'::text, 'success'::text, 'failed'::text]))))
);


--
-- Name: lot_purchases; Type: TABLE; Schema: primary_evacuation; Owner: -
--

CREATE TABLE primary_evacuation.lot_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    lot_id uuid NOT NULL,
    purchase_id_raw text NOT NULL,
    purchase_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lots; Type: TABLE; Schema: primary_evacuation; Owner: -
--

CREATE TABLE primary_evacuation.lots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kobo_uuid text NOT NULL,
    kobo_id bigint NOT NULL,
    form_version text NOT NULL,
    primary_waybill_number text NOT NULL,
    cooperative_id uuid,
    station_mark_number text,
    pc_name text,
    society text,
    district_depot text,
    district_warehouse text NOT NULL,
    evacuation_date date NOT NULL,
    bags_received integer NOT NULL,
    kg_received numeric(11,1) NOT NULL,
    driver_first_name text,
    driver_last_name text,
    truck_registration text,
    lot_photo_url text,
    raw_data jsonb NOT NULL,
    submitted_at timestamp with time zone NOT NULL,
    submitted_by text,
    snapshot_url text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    seal_number text,
    CONSTRAINT primary_evac_lots_bags_check CHECK ((bags_received > 0)),
    CONSTRAINT primary_evac_lots_kg_check CHECK ((kg_received > (0)::numeric))
);


--
-- Name: cocoa_purchases; Type: TABLE; Schema: purchase; Owner: -
--

CREATE TABLE purchase.cocoa_purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kobo_uuid text NOT NULL,
    kobo_id bigint NOT NULL,
    form_version text NOT NULL,
    purchase_id text NOT NULL,
    cooperative_id uuid,
    farmer_id text,
    parcel_id text,
    station_mark_number text,
    pc_name text,
    society text,
    district text,
    farmer_code text NOT NULL,
    farmer_name text,
    cocobod_card_number text,
    field_id text,
    purchase_date date NOT NULL,
    weight_kg numeric(10,3) NOT NULL,
    amount_received_ghs numeric(12,2) NOT NULL,
    payment_type text NOT NULL,
    payment_reference text,
    raw_data jsonb NOT NULL,
    submitted_at timestamp with time zone NOT NULL,
    submitted_by text,
    snapshot_url text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT cocoa_purchases_amount_check CHECK ((amount_received_ghs >= (0)::numeric)),
    CONSTRAINT cocoa_purchases_payment_type_check CHECK ((payment_type = ANY (ARRAY['cash'::text, 'mobile_money'::text, 'cheque'::text, 'card'::text]))),
    CONSTRAINT cocoa_purchases_weight_check CHECK ((weight_kg > (0)::numeric))
);


--
-- Name: eudr_commodity; Type: TABLE; Schema: reference; Owner: -
--

CREATE TABLE reference.eudr_commodity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    hs_codes text[] DEFAULT '{}'::text[] NOT NULL,
    source_version text NOT NULL,
    effective_from date NOT NULL,
    retired_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: eudr_country_risk; Type: TABLE; Schema: reference; Owner: -
--

CREATE TABLE reference.eudr_country_risk (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    iso2 character(2) NOT NULL,
    iso3 character(3),
    country_name text NOT NULL,
    risk_level text NOT NULL,
    source_version text NOT NULL,
    effective_from date NOT NULL,
    retired_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT eudr_country_risk_level_check CHECK ((risk_level = ANY (ARRAY['low'::text, 'standard'::text, 'high'::text, 'unclassified'::text])))
);


--
-- Name: eudr_hs_code; Type: TABLE; Schema: reference; Owner: -
--

CREATE TABLE reference.eudr_hs_code (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    description text NOT NULL,
    cocoa_scope boolean DEFAULT false NOT NULL,
    source_version text NOT NULL,
    effective_from date NOT NULL,
    retired_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ra_indicator; Type: TABLE; Schema: reference; Owner: -
--

CREATE TABLE reference.ra_indicator (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    code text NOT NULL,
    source_version text NOT NULL,
    category text NOT NULL,
    label_en text NOT NULL,
    label_fr text,
    label_vi text,
    severity_default text,
    effective_from date NOT NULL,
    retired_at date,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ra_indicator_severity_check CHECK (((severity_default IS NULL) OR (severity_default = ANY (ARRAY['minor'::text, 'major'::text, 'critical'::text]))))
);


--
-- Name: dashboard_snapshots; Type: TABLE; Schema: reporting; Owner: -
--

CREATE TABLE reporting.dashboard_snapshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cooperative_id uuid,
    snapshot_type text NOT NULL,
    snapshot_date date NOT NULL,
    payload jsonb,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    source_version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: inspection_report_cache; Type: TABLE; Schema: reporting; Owner: -
--

CREATE TABLE reporting.inspection_report_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cooperative_id uuid,
    inspection_year integer,
    payload jsonb,
    refreshed_at timestamp with time zone,
    source_version text
);


--
-- Name: report_files; Type: TABLE; Schema: reporting; Owner: -
--

CREATE TABLE reporting.report_files (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_run_id uuid NOT NULL,
    storage_key text NOT NULL,
    file_name text,
    mime_type text,
    size_bytes bigint,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: report_runs; Type: TABLE; Schema: reporting; Owner: -
--

CREATE TABLE reporting.report_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    report_code text NOT NULL,
    requested_by_user_id uuid,
    cooperative_id uuid,
    district_scope text,
    parameters jsonb,
    output_format text NOT NULL,
    status text DEFAULT 'queued'::text NOT NULL,
    generated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    error_message text,
    CONSTRAINT report_runs_format_check CHECK ((output_format = ANY (ARRAY['pdf'::text, 'excel'::text, 'csv'::text, 'json'::text]))),
    CONSTRAINT report_runs_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'completed'::text, 'failed'::text])))
);


--
-- Name: traceability_report_cache; Type: TABLE; Schema: reporting; Owner: -
--

CREATE TABLE reporting.traceability_report_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cooperative_id uuid,
    season text,
    payload jsonb,
    refreshed_at timestamp with time zone,
    source_version text
);


--
-- Name: lot_primaries; Type: TABLE; Schema: secondary_evacuation; Owner: -
--

CREATE TABLE secondary_evacuation.lot_primaries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    secondary_lot_id uuid NOT NULL,
    primary_waybill_raw text NOT NULL,
    primary_lot_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: lots; Type: TABLE; Schema: secondary_evacuation; Owner: -
--

CREATE TABLE secondary_evacuation.lots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kobo_uuid text NOT NULL,
    kobo_id bigint NOT NULL,
    form_version text NOT NULL,
    secondary_waybill_number text NOT NULL,
    cooperative_id uuid,
    evacuation_date date NOT NULL,
    district text NOT NULL,
    depot_origin text NOT NULL,
    depot_gps text,
    bean_grade text NOT NULL,
    bean_category text NOT NULL,
    seal_number text NOT NULL,
    sourcing_partner text NOT NULL,
    bags_loaded integer NOT NULL,
    port_destination text NOT NULL,
    driver_first_name text,
    driver_last_name text,
    driver_licence_number text,
    truck_registration text,
    qcc_image_url text,
    raw_data jsonb NOT NULL,
    submitted_at timestamp with time zone NOT NULL,
    submitted_by text,
    snapshot_url text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    dds_status text DEFAULT 'draft'::text NOT NULL,
    dds_reference text,
    dds_submitted_at timestamp with time zone,
    CONSTRAINT secondary_evac_lots_bags_check CHECK ((bags_loaded > 0)),
    CONSTRAINT secondary_evac_lots_dds_status_check CHECK ((dds_status = ANY (ARRAY['draft'::text, 'ready'::text, 'submitted'::text, 'accepted'::text, 'rejected'::text, 'withdrawn'::text])))
);


--
-- Name: survival_checks; Type: TABLE; Schema: shade; Owner: -
--

CREATE TABLE shade.survival_checks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cooperative_id uuid NOT NULL,
    farmer_id text,
    parcel_id text NOT NULL,
    total_trees integer NOT NULL,
    alive_trees integer NOT NULL,
    dead_trees integer NOT NULL,
    survival_pct numeric(5,2) NOT NULL,
    last_observed_at date NOT NULL,
    computed_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tree_profiling; Type: TABLE; Schema: shade; Owner: -
--

CREATE TABLE shade.tree_profiling (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kobo_uuid text NOT NULL,
    kobo_id bigint NOT NULL,
    form_version text NOT NULL,
    cooperative_id uuid,
    farmer_id text,
    parcel_id text,
    farmer_name text,
    district text,
    society text,
    enumerator text,
    date_observed date NOT NULL,
    species text NOT NULL,
    tree_tag_num text,
    dbh_cm numeric(6,1),
    height_class text,
    tree_condition text,
    is_alive boolean NOT NULL,
    gps_point text,
    photo_filename text,
    raw_data jsonb NOT NULL,
    submitted_at timestamp with time zone NOT NULL,
    submitted_by text,
    snapshot_url text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: batch_items; Type: TABLE; Schema: traceability; Owner: -
--

CREATE TABLE traceability.batch_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    batch_id uuid NOT NULL,
    purchase_id uuid NOT NULL,
    weight_kg numeric(12,3) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: batches; Type: TABLE; Schema: traceability; Owner: -
--

CREATE TABLE traceability.batches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cooperative_id uuid NOT NULL,
    batch_number text NOT NULL,
    season text,
    batch_type text NOT NULL,
    status text DEFAULT 'open'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT batches_status_check CHECK ((status = ANY (ARRAY['open'::text, 'closed'::text, 'exported'::text, 'cancelled'::text]))),
    CONSTRAINT batches_type_check CHECK ((batch_type = ANY (ARRAY['primary'::text, 'secondary'::text, 'blended'::text])))
);


--
-- Name: purchases; Type: TABLE; Schema: traceability; Owner: -
--

CREATE TABLE traceability.purchases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cooperative_id uuid NOT NULL,
    farmer_id text NOT NULL,
    parcel_id text,
    purchase_level text NOT NULL,
    purchase_date date NOT NULL,
    quantity_kg numeric(12,3) NOT NULL,
    quality_grade text,
    price_per_kg numeric(12,4),
    source_submission_uuid text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    deleted_by uuid,
    CONSTRAINT purchases_level_check CHECK ((purchase_level = ANY (ARRAY['primary'::text, 'secondary'::text])))
);


--
-- Name: trace_links; Type: TABLE; Schema: traceability; Owner: -
--

CREATE TABLE traceability.trace_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    cooperative_id uuid NOT NULL,
    batch_id uuid NOT NULL,
    purchase_id uuid NOT NULL,
    farmer_id text NOT NULL,
    parcel_id text,
    snapshot_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_attendance; Type: TABLE; Schema: training; Owner: -
--

CREATE TABLE training.training_attendance (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    farmer_id text,
    farmer_code text NOT NULL,
    farmer_name text,
    gender text,
    cooperative text,
    phone text,
    consent boolean DEFAULT false NOT NULL,
    signature_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: training_sessions; Type: TABLE; Schema: training; Owner: -
--

CREATE TABLE training.training_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kobo_uuid text NOT NULL,
    kobo_id bigint NOT NULL,
    form_version text NOT NULL,
    cooperative_id uuid,
    training_date date NOT NULL,
    start_time text,
    end_time text,
    duration_minutes integer,
    program text,
    training_type text,
    training_topics text[],
    participant_category text,
    district text,
    society text,
    venue text,
    trainer_name text,
    trainer_phone text,
    num_male smallint,
    num_female smallint,
    total_participants smallint,
    consent_count smallint,
    consent_rate numeric(5,2),
    session_objectives_met boolean,
    participant_engagement text,
    trainer_remarks text,
    trainer_signature_url text,
    raw_data jsonb NOT NULL,
    submitted_at timestamp with time zone NOT NULL,
    submitted_by text,
    snapshot_url text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT training_sessions_engagement_check CHECK (((participant_engagement IS NULL) OR (participant_engagement = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text]))))
);


--
-- Name: groups; Type: TABLE; Schema: vsla; Owner: -
--

CREATE TABLE vsla.groups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    natural_key text NOT NULL,
    group_number text NOT NULL,
    group_name text NOT NULL,
    enumerator_id text NOT NULL,
    enumerator_prefix text NOT NULL,
    cooperative_id uuid,
    community_worker_name text,
    share_value numeric(12,2),
    interest_fee numeric(6,2),
    latest_report_month date,
    latest_active_members integer,
    latest_savings_cumulative numeric(14,2),
    latest_late_loans_count integer,
    latest_has_discrepancy boolean,
    report_count integer DEFAULT 0 NOT NULL,
    discrepancy_count integer DEFAULT 0 NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: monthly_reports; Type: TABLE; Schema: vsla; Owner: -
--

CREATE TABLE vsla.monthly_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kobo_uuid text NOT NULL,
    kobo_id bigint NOT NULL,
    form_version text NOT NULL,
    group_id uuid NOT NULL,
    cooperative_id uuid,
    report_month date NOT NULL,
    active_members_at_visit integer,
    male_members integer,
    female_members integer,
    members_attending_meeting integer,
    total_members_start_cycle integer,
    num_dropouts integer,
    savings_cumulative numeric(14,2),
    savings_value_month numeric(14,2),
    active_loans_count integer,
    active_loans_value numeric(14,2),
    late_loans_count integer,
    late_loans_unpaid_balance numeric(14,2),
    writeoffs_value numeric(14,2),
    cash_loan_fund numeric(14,2),
    cash_social_fund numeric(14,2),
    has_external_loans boolean,
    has_external_savings boolean,
    verify_loan_fund_match boolean,
    verify_social_fund_match boolean,
    verify_register_loan_fund boolean,
    verify_register_social_fund boolean,
    has_discrepancy boolean DEFAULT false NOT NULL,
    comments text,
    gps_location text,
    raw_data jsonb NOT NULL,
    submitted_at timestamp with time zone NOT NULL,
    submitted_by text,
    snapshot_url text,
    synced_at timestamp with time zone DEFAULT now() NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.audit_logs ALTER COLUMN id SET DEFAULT nextval('audit.audit_logs_id_seq'::regclass);


--
-- Name: audit_attachment audit_attachment_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.audit_attachment
    ADD CONSTRAINT audit_attachment_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: report_audit_logs report_audit_logs_pkey; Type: CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.report_audit_logs
    ADD CONSTRAINT report_audit_logs_pkey PRIMARY KEY (id);


--
-- Name: coaching_visits coaching_visits_kobo_uuid_uk; Type: CONSTRAINT; Schema: coaching; Owner: -
--

ALTER TABLE ONLY coaching.coaching_visits
    ADD CONSTRAINT coaching_visits_kobo_uuid_uk UNIQUE (kobo_uuid);


--
-- Name: coaching_visits coaching_visits_pkey; Type: CONSTRAINT; Schema: coaching; Owner: -
--

ALTER TABLE ONLY coaching.coaching_visits
    ADD CONSTRAINT coaching_visits_pkey PRIMARY KEY (id);


--
-- Name: farmer_photos farmer_photos_pkey; Type: CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.farmer_photos
    ADD CONSTRAINT farmer_photos_pkey PRIMARY KEY (id);


--
-- Name: farmers farmers_pkey; Type: CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.farmers
    ADD CONSTRAINT farmers_pkey PRIMARY KEY (id);


--
-- Name: household_members household_members_pkey; Type: CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.household_members
    ADD CONSTRAINT household_members_pkey PRIMARY KEY (id);


--
-- Name: profile_change_history profile_change_history_pkey; Type: CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.profile_change_history
    ADD CONSTRAINT profile_change_history_pkey PRIMARY KEY (id);


--
-- Name: coaching_reports coaching_reports_pkey; Type: CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.coaching_reports
    ADD CONSTRAINT coaching_reports_pkey PRIMARY KEY (id);


--
-- Name: coaching_visits coaching_visits_pkey; Type: CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.coaching_visits
    ADD CONSTRAINT coaching_visits_pkey PRIMARY KEY (id);


--
-- Name: farm_development_plans farm_development_plans_pkey; Type: CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.farm_development_plans
    ADD CONSTRAINT farm_development_plans_pkey PRIMARY KEY (id);


--
-- Name: follow_up_actions follow_up_actions_pkey; Type: CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.follow_up_actions
    ADD CONSTRAINT follow_up_actions_pkey PRIMARY KEY (id);


--
-- Name: inspection_findings inspection_findings_pkey; Type: CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.inspection_findings
    ADD CONSTRAINT inspection_findings_pkey PRIMARY KEY (id);


--
-- Name: inspections inspections_pkey; Type: CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.inspections
    ADD CONSTRAINT inspections_pkey PRIMARY KEY (id);


--
-- Name: training_attendance training_attendance_pkey; Type: CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_attendance
    ADD CONSTRAINT training_attendance_pkey PRIMARY KEY (id);


--
-- Name: training_modules training_modules_pkey; Type: CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_modules
    ADD CONSTRAINT training_modules_pkey PRIMARY KEY (id);


--
-- Name: training_sessions training_sessions_pkey; Type: CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_sessions
    ADD CONSTRAINT training_sessions_pkey PRIMARY KEY (id);


--
-- Name: eudr_status eudr_status_parcel_id_unique; Type: CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.eudr_status
    ADD CONSTRAINT eudr_status_parcel_id_unique UNIQUE (parcel_id);


--
-- Name: eudr_status eudr_status_pkey; Type: CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.eudr_status
    ADD CONSTRAINT eudr_status_pkey PRIMARY KEY (id);


--
-- Name: geo_import_jobs geo_import_jobs_pkey; Type: CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.geo_import_jobs
    ADD CONSTRAINT geo_import_jobs_pkey PRIMARY KEY (id);


--
-- Name: parcel_characteristics parcel_characteristics_parcel_id_unique; Type: CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcel_characteristics
    ADD CONSTRAINT parcel_characteristics_parcel_id_unique UNIQUE (parcel_id);


--
-- Name: parcel_characteristics parcel_characteristics_pkey; Type: CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcel_characteristics
    ADD CONSTRAINT parcel_characteristics_pkey PRIMARY KEY (id);


--
-- Name: parcel_geometries parcel_geometries_parcel_id_unique; Type: CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcel_geometries
    ADD CONSTRAINT parcel_geometries_parcel_id_unique UNIQUE (parcel_id);


--
-- Name: parcel_geometries parcel_geometries_pkey; Type: CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcel_geometries
    ADD CONSTRAINT parcel_geometries_pkey PRIMARY KEY (id);


--
-- Name: parcel_overlap_flags parcel_overlap_flags_pkey; Type: CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcel_overlap_flags
    ADD CONSTRAINT parcel_overlap_flags_pkey PRIMARY KEY (id);


--
-- Name: parcels parcels_pkey; Type: CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcels
    ADD CONSTRAINT parcels_pkey PRIMARY KEY (id);


--
-- Name: accounts accounts_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.accounts
    ADD CONSTRAINT accounts_pkey PRIMARY KEY (id);


--
-- Name: cooperatives cooperatives_code_unique; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.cooperatives
    ADD CONSTRAINT cooperatives_code_unique UNIQUE (code);


--
-- Name: cooperatives cooperatives_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.cooperatives
    ADD CONSTRAINT cooperatives_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_code_unique; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.permissions
    ADD CONSTRAINT permissions_code_unique UNIQUE (code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_role_id_permission_id_pk; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.role_permissions
    ADD CONSTRAINT role_permissions_role_id_permission_id_pk PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_code_unique; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.roles
    ADD CONSTRAINT roles_code_unique UNIQUE (code);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sessions sessions_token_unique; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.sessions
    ADD CONSTRAINT sessions_token_unique UNIQUE (token);


--
-- Name: user_cooperative_assignments user_cooperative_assignments_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_cooperative_assignments
    ADD CONSTRAINT user_cooperative_assignments_pkey PRIMARY KEY (id);


--
-- Name: user_notification_pref user_notification_pref_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_notification_pref
    ADD CONSTRAINT user_notification_pref_pkey PRIMARY KEY (user_id, resource);


--
-- Name: user_roles user_roles_user_id_role_id_pk; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_roles
    ADD CONSTRAINT user_roles_user_id_role_id_pk PRIMARY KEY (user_id, role_id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: verifications verifications_pkey; Type: CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.verifications
    ADD CONSTRAINT verifications_pkey PRIMARY KEY (id);


--
-- Name: attachments attachments_kobo_uid_uk; Type: CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.attachments
    ADD CONSTRAINT attachments_kobo_uid_uk UNIQUE (kobo_uid);


--
-- Name: attachments attachments_pkey; Type: CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.attachments
    ADD CONSTRAINT attachments_pkey PRIMARY KEY (id);


--
-- Name: corrective_actions corrective_actions_inspection_topic_uk; Type: CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.corrective_actions
    ADD CONSTRAINT corrective_actions_inspection_topic_uk UNIQUE (inspection_id, topic);


--
-- Name: corrective_actions corrective_actions_pkey; Type: CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.corrective_actions
    ADD CONSTRAINT corrective_actions_pkey PRIMARY KEY (id);


--
-- Name: inspections inspections_kobo_uuid_uk; Type: CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.inspections
    ADD CONSTRAINT inspections_kobo_uuid_uk UNIQUE (kobo_uuid);


--
-- Name: inspections inspections_pkey; Type: CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.inspections
    ADD CONSTRAINT inspections_pkey PRIMARY KEY (id);


--
-- Name: attachment_link attachment_link_pkey; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.attachment_link
    ADD CONSTRAINT attachment_link_pkey PRIMARY KEY (id);


--
-- Name: kobo_attachment kobo_attachment_pkey; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.kobo_attachment
    ADD CONSTRAINT kobo_attachment_pkey PRIMARY KEY (id);


--
-- Name: kobo_submissions_raw kobo_submissions_raw_pkey; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.kobo_submissions_raw
    ADD CONSTRAINT kobo_submissions_raw_pkey PRIMARY KEY (id);


--
-- Name: kobo_submissions_raw kobo_submissions_raw_submission_uuid_unique; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.kobo_submissions_raw
    ADD CONSTRAINT kobo_submissions_raw_submission_uuid_unique UNIQUE (submission_uuid);


--
-- Name: kobo_validation_errors kobo_validation_errors_pkey; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.kobo_validation_errors
    ADD CONSTRAINT kobo_validation_errors_pkey PRIMARY KEY (id);


--
-- Name: migration_jobs migration_jobs_pkey; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.migration_jobs
    ADD CONSTRAINT migration_jobs_pkey PRIMARY KEY (id);


--
-- Name: reconciliation_results reconciliation_results_pkey; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.reconciliation_results
    ADD CONSTRAINT reconciliation_results_pkey PRIMARY KEY (id);


--
-- Name: sync_cursors sync_cursors_pkey; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.sync_cursors
    ADD CONSTRAINT sync_cursors_pkey PRIMARY KEY (id);


--
-- Name: sync_errors sync_errors_pkey; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.sync_errors
    ADD CONSTRAINT sync_errors_pkey PRIMARY KEY (id);


--
-- Name: sync_jobs sync_jobs_pkey; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.sync_jobs
    ADD CONSTRAINT sync_jobs_pkey PRIMARY KEY (id);


--
-- Name: sync_settings sync_settings_job_key_key; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.sync_settings
    ADD CONSTRAINT sync_settings_job_key_key UNIQUE (job_key);


--
-- Name: sync_settings sync_settings_pkey; Type: CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.sync_settings
    ADD CONSTRAINT sync_settings_pkey PRIMARY KEY (id);


--
-- Name: lot_purchases lot_purchases_pkey; Type: CONSTRAINT; Schema: primary_evacuation; Owner: -
--

ALTER TABLE ONLY primary_evacuation.lot_purchases
    ADD CONSTRAINT lot_purchases_pkey PRIMARY KEY (id);


--
-- Name: lots lots_pkey; Type: CONSTRAINT; Schema: primary_evacuation; Owner: -
--

ALTER TABLE ONLY primary_evacuation.lots
    ADD CONSTRAINT lots_pkey PRIMARY KEY (id);


--
-- Name: lot_purchases primary_evac_lot_purchases_lot_pid_uk; Type: CONSTRAINT; Schema: primary_evacuation; Owner: -
--

ALTER TABLE ONLY primary_evacuation.lot_purchases
    ADD CONSTRAINT primary_evac_lot_purchases_lot_pid_uk UNIQUE (lot_id, purchase_id_raw);


--
-- Name: lots primary_evac_lots_kobo_uuid_uk; Type: CONSTRAINT; Schema: primary_evacuation; Owner: -
--

ALTER TABLE ONLY primary_evacuation.lots
    ADD CONSTRAINT primary_evac_lots_kobo_uuid_uk UNIQUE (kobo_uuid);


--
-- Name: cocoa_purchases cocoa_purchases_kobo_uuid_uk; Type: CONSTRAINT; Schema: purchase; Owner: -
--

ALTER TABLE ONLY purchase.cocoa_purchases
    ADD CONSTRAINT cocoa_purchases_kobo_uuid_uk UNIQUE (kobo_uuid);


--
-- Name: cocoa_purchases cocoa_purchases_pkey; Type: CONSTRAINT; Schema: purchase; Owner: -
--

ALTER TABLE ONLY purchase.cocoa_purchases
    ADD CONSTRAINT cocoa_purchases_pkey PRIMARY KEY (id);


--
-- Name: eudr_commodity eudr_commodity_pkey; Type: CONSTRAINT; Schema: reference; Owner: -
--

ALTER TABLE ONLY reference.eudr_commodity
    ADD CONSTRAINT eudr_commodity_pkey PRIMARY KEY (id);


--
-- Name: eudr_country_risk eudr_country_risk_pkey; Type: CONSTRAINT; Schema: reference; Owner: -
--

ALTER TABLE ONLY reference.eudr_country_risk
    ADD CONSTRAINT eudr_country_risk_pkey PRIMARY KEY (id);


--
-- Name: eudr_hs_code eudr_hs_code_pkey; Type: CONSTRAINT; Schema: reference; Owner: -
--

ALTER TABLE ONLY reference.eudr_hs_code
    ADD CONSTRAINT eudr_hs_code_pkey PRIMARY KEY (id);


--
-- Name: ra_indicator ra_indicator_pkey; Type: CONSTRAINT; Schema: reference; Owner: -
--

ALTER TABLE ONLY reference.ra_indicator
    ADD CONSTRAINT ra_indicator_pkey PRIMARY KEY (id);


--
-- Name: dashboard_snapshots dashboard_snapshots_pkey; Type: CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.dashboard_snapshots
    ADD CONSTRAINT dashboard_snapshots_pkey PRIMARY KEY (id);


--
-- Name: inspection_report_cache inspection_report_cache_pkey; Type: CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.inspection_report_cache
    ADD CONSTRAINT inspection_report_cache_pkey PRIMARY KEY (id);


--
-- Name: report_files report_files_pkey; Type: CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.report_files
    ADD CONSTRAINT report_files_pkey PRIMARY KEY (id);


--
-- Name: report_runs report_runs_pkey; Type: CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.report_runs
    ADD CONSTRAINT report_runs_pkey PRIMARY KEY (id);


--
-- Name: traceability_report_cache traceability_report_cache_pkey; Type: CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.traceability_report_cache
    ADD CONSTRAINT traceability_report_cache_pkey PRIMARY KEY (id);


--
-- Name: lot_primaries lot_primaries_pkey; Type: CONSTRAINT; Schema: secondary_evacuation; Owner: -
--

ALTER TABLE ONLY secondary_evacuation.lot_primaries
    ADD CONSTRAINT lot_primaries_pkey PRIMARY KEY (id);


--
-- Name: lots lots_pkey; Type: CONSTRAINT; Schema: secondary_evacuation; Owner: -
--

ALTER TABLE ONLY secondary_evacuation.lots
    ADD CONSTRAINT lots_pkey PRIMARY KEY (id);


--
-- Name: lot_primaries secondary_evac_lot_primaries_uk; Type: CONSTRAINT; Schema: secondary_evacuation; Owner: -
--

ALTER TABLE ONLY secondary_evacuation.lot_primaries
    ADD CONSTRAINT secondary_evac_lot_primaries_uk UNIQUE (secondary_lot_id, primary_waybill_raw);


--
-- Name: lots secondary_evac_lots_kobo_uuid_uk; Type: CONSTRAINT; Schema: secondary_evacuation; Owner: -
--

ALTER TABLE ONLY secondary_evacuation.lots
    ADD CONSTRAINT secondary_evac_lots_kobo_uuid_uk UNIQUE (kobo_uuid);


--
-- Name: survival_checks survival_checks_pkey; Type: CONSTRAINT; Schema: shade; Owner: -
--

ALTER TABLE ONLY shade.survival_checks
    ADD CONSTRAINT survival_checks_pkey PRIMARY KEY (id);


--
-- Name: tree_profiling tree_profiling_pkey; Type: CONSTRAINT; Schema: shade; Owner: -
--

ALTER TABLE ONLY shade.tree_profiling
    ADD CONSTRAINT tree_profiling_pkey PRIMARY KEY (id);


--
-- Name: batch_items batch_items_pkey; Type: CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.batch_items
    ADD CONSTRAINT batch_items_pkey PRIMARY KEY (id);


--
-- Name: batches batches_batch_number_unique; Type: CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.batches
    ADD CONSTRAINT batches_batch_number_unique UNIQUE (batch_number);


--
-- Name: batches batches_pkey; Type: CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.batches
    ADD CONSTRAINT batches_pkey PRIMARY KEY (id);


--
-- Name: purchases purchases_pkey; Type: CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.purchases
    ADD CONSTRAINT purchases_pkey PRIMARY KEY (id);


--
-- Name: trace_links trace_links_pkey; Type: CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.trace_links
    ADD CONSTRAINT trace_links_pkey PRIMARY KEY (id);


--
-- Name: training_attendance training_attendance_pkey; Type: CONSTRAINT; Schema: training; Owner: -
--

ALTER TABLE ONLY training.training_attendance
    ADD CONSTRAINT training_attendance_pkey PRIMARY KEY (id);


--
-- Name: training_attendance training_attendance_session_farmer_uk; Type: CONSTRAINT; Schema: training; Owner: -
--

ALTER TABLE ONLY training.training_attendance
    ADD CONSTRAINT training_attendance_session_farmer_uk UNIQUE (session_id, farmer_code);


--
-- Name: training_sessions training_sessions_kobo_uuid_uk; Type: CONSTRAINT; Schema: training; Owner: -
--

ALTER TABLE ONLY training.training_sessions
    ADD CONSTRAINT training_sessions_kobo_uuid_uk UNIQUE (kobo_uuid);


--
-- Name: training_sessions training_sessions_pkey; Type: CONSTRAINT; Schema: training; Owner: -
--

ALTER TABLE ONLY training.training_sessions
    ADD CONSTRAINT training_sessions_pkey PRIMARY KEY (id);


--
-- Name: groups groups_pkey; Type: CONSTRAINT; Schema: vsla; Owner: -
--

ALTER TABLE ONLY vsla.groups
    ADD CONSTRAINT groups_pkey PRIMARY KEY (id);


--
-- Name: monthly_reports monthly_reports_pkey; Type: CONSTRAINT; Schema: vsla; Owner: -
--

ALTER TABLE ONLY vsla.monthly_reports
    ADD CONSTRAINT monthly_reports_pkey PRIMARY KEY (id);


--
-- Name: idx_audit_attachment_log; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX idx_audit_attachment_log ON audit.audit_attachment USING btree (audit_log_id);


--
-- Name: idx_audit_logs_actor; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX idx_audit_logs_actor ON audit.audit_logs USING btree (actor_user_id, created_at DESC);


--
-- Name: idx_audit_logs_coop; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX idx_audit_logs_coop ON audit.audit_logs USING btree (cooperative_id, created_at DESC);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX idx_audit_logs_created_at ON audit.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_entity; Type: INDEX; Schema: audit; Owner: -
--

CREATE INDEX idx_audit_logs_entity ON audit.audit_logs USING btree (entity_table, entity_id, created_at DESC);


--
-- Name: coaching_visits_clmrs_risk_idx; Type: INDEX; Schema: coaching; Owner: -
--

CREATE INDEX coaching_visits_clmrs_risk_idx ON coaching.coaching_visits USING btree (clmrs_risk_level) WHERE ((clmrs_risk_level IS NOT NULL) AND (clmrs_risk_level <> 'no_risk'::text));


--
-- Name: coaching_visits_cooperative_date_idx; Type: INDEX; Schema: coaching; Owner: -
--

CREATE INDEX coaching_visits_cooperative_date_idx ON coaching.coaching_visits USING btree (cooperative_id, visit_date DESC);


--
-- Name: coaching_visits_farmer_date_idx; Type: INDEX; Schema: coaching; Owner: -
--

CREATE INDEX coaching_visits_farmer_date_idx ON coaching.coaching_visits USING btree (farmer_id, visit_date DESC);


--
-- Name: coaching_visits_followup_idx; Type: INDEX; Schema: coaching; Owner: -
--

CREATE INDEX coaching_visits_followup_idx ON coaching.coaching_visits USING btree (follow_up_date) WHERE (follow_up_required = true);


--
-- Name: coaching_visits_parcel_idx; Type: INDEX; Schema: coaching; Owner: -
--

CREATE INDEX coaching_visits_parcel_idx ON coaching.coaching_visits USING btree (parcel_id);


--
-- Name: coaching_visits_raw_data_gin; Type: INDEX; Schema: coaching; Owner: -
--

CREATE INDEX coaching_visits_raw_data_gin ON coaching.coaching_visits USING gin (raw_data);


--
-- Name: coaching_visits_visit_date_idx; Type: INDEX; Schema: coaching; Owner: -
--

CREATE INDEX coaching_visits_visit_date_idx ON coaching.coaching_visits USING btree (visit_date DESC);


--
-- Name: idx_farmer_farmers_active; Type: INDEX; Schema: farmer; Owner: -
--

CREATE INDEX idx_farmer_farmers_active ON farmer.farmers USING btree (is_active);


--
-- Name: idx_farmer_farmers_cooperative_id; Type: INDEX; Schema: farmer; Owner: -
--

CREATE INDEX idx_farmer_farmers_cooperative_id ON farmer.farmers USING btree (cooperative_id);


--
-- Name: idx_farmers_active_by_coop; Type: INDEX; Schema: farmer; Owner: -
--

CREATE INDEX idx_farmers_active_by_coop ON farmer.farmers USING btree (cooperative_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_household_members_farmer; Type: INDEX; Schema: farmer; Owner: -
--

CREATE INDEX idx_household_members_farmer ON farmer.household_members USING btree (farmer_id);


--
-- Name: attendance_session_farmer_uk; Type: INDEX; Schema: field_ops; Owner: -
--

CREATE UNIQUE INDEX attendance_session_farmer_uk ON field_ops.training_attendance USING btree (session_id, farmer_id);


--
-- Name: idx_inspections_active_by_farmer; Type: INDEX; Schema: field_ops; Owner: -
--

CREATE INDEX idx_inspections_active_by_farmer ON field_ops.inspections USING btree (farmer_id, inspection_year) WHERE (deleted_at IS NULL);


--
-- Name: inspections_farmer_year_uk; Type: INDEX; Schema: field_ops; Owner: -
--

CREATE UNIQUE INDEX inspections_farmer_year_uk ON field_ops.inspections USING btree (farmer_id, inspection_year);


--
-- Name: idx_parcels_active_by_coop; Type: INDEX; Schema: gis; Owner: -
--

CREATE INDEX idx_parcels_active_by_coop ON gis.parcels USING btree (cooperative_id) WHERE (deleted_at IS NULL);


--
-- Name: idx_parcels_active_by_farmer; Type: INDEX; Schema: gis; Owner: -
--

CREATE INDEX idx_parcels_active_by_farmer ON gis.parcels USING btree (farmer_id) WHERE (deleted_at IS NULL);


--
-- Name: overlap_parcels_uk; Type: INDEX; Schema: gis; Owner: -
--

CREATE UNIQUE INDEX overlap_parcels_uk ON gis.parcel_overlap_flags USING btree (parcel_id, nearby_parcel_id);


--
-- Name: accounts_user_idx; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX accounts_user_idx ON iam.accounts USING btree (user_id);


--
-- Name: role_permissions_permission_idx; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX role_permissions_permission_idx ON iam.role_permissions USING btree (permission_id);


--
-- Name: sessions_user_idx; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX sessions_user_idx ON iam.sessions USING btree (user_id);


--
-- Name: uca_cooperative_idx; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX uca_cooperative_idx ON iam.user_cooperative_assignments USING btree (cooperative_id);


--
-- Name: uca_user_coop_uk; Type: INDEX; Schema: iam; Owner: -
--

CREATE UNIQUE INDEX uca_user_coop_uk ON iam.user_cooperative_assignments USING btree (user_id, cooperative_id);


--
-- Name: user_roles_role_idx; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX user_roles_role_idx ON iam.user_roles USING btree (role_id);


--
-- Name: verifications_identifier_idx; Type: INDEX; Schema: iam; Owner: -
--

CREATE INDEX verifications_identifier_idx ON iam.verifications USING btree (identifier);


--
-- Name: corrective_actions_coaching_topic_uk; Type: INDEX; Schema: inspection; Owner: -
--

CREATE UNIQUE INDEX corrective_actions_coaching_topic_uk ON inspection.corrective_actions USING btree (coaching_visit_id, topic) WHERE (coaching_visit_id IS NOT NULL);


--
-- Name: idx_attachments_inspection; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_attachments_inspection ON inspection.attachments USING btree (inspection_id);


--
-- Name: idx_corrective_actions_coaching_open; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_corrective_actions_coaching_open ON inspection.corrective_actions USING btree (coaching_visit_id) WHERE (status <> 'done'::text);


--
-- Name: idx_corrective_actions_coop; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_corrective_actions_coop ON inspection.corrective_actions USING btree (cooperative_id);


--
-- Name: idx_corrective_actions_farmer_open; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_corrective_actions_farmer_open ON inspection.corrective_actions USING btree (farmer_id) WHERE (status <> 'done'::text);


--
-- Name: idx_corrective_actions_parcel_open; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_corrective_actions_parcel_open ON inspection.corrective_actions USING btree (parcel_id) WHERE (status <> 'done'::text);


--
-- Name: idx_inspections_compliance_pct; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_inspections_compliance_pct ON inspection.inspections USING btree (compliance_pct DESC);


--
-- Name: idx_inspections_coop_date; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_inspections_coop_date ON inspection.inspections USING btree (cooperative_id, date_inspection DESC);


--
-- Name: idx_inspections_eudr_status; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_inspections_eudr_status ON inspection.inspections USING btree (eudr_status);


--
-- Name: idx_inspections_farmer_date; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_inspections_farmer_date ON inspection.inspections USING btree (farmer_id, date_inspection DESC);


--
-- Name: idx_inspections_farmer_date_desc; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_inspections_farmer_date_desc ON inspection.inspections USING btree (farmer_id, date_inspection DESC);


--
-- Name: idx_inspections_parcel_date; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_inspections_parcel_date ON inspection.inspections USING btree (parcel_id, date_inspection DESC);


--
-- Name: idx_inspections_parcel_latest; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_inspections_parcel_latest ON inspection.inspections USING btree (parcel_id, date_inspection DESC, eudr_status);


--
-- Name: idx_inspections_raw_gin; Type: INDEX; Schema: inspection; Owner: -
--

CREATE INDEX idx_inspections_raw_gin ON inspection.inspections USING gin (raw_data jsonb_path_ops);


--
-- Name: attachment_link_uk; Type: INDEX; Schema: integration; Owner: -
--

CREATE UNIQUE INDEX attachment_link_uk ON integration.attachment_link USING btree (attachment_id, entity_type, entity_id);


--
-- Name: idx_attachment_link_entity; Type: INDEX; Schema: integration; Owner: -
--

CREATE INDEX idx_attachment_link_entity ON integration.attachment_link USING btree (entity_type, entity_id);


--
-- Name: idx_kobo_attachment_pending; Type: INDEX; Schema: integration; Owner: -
--

CREATE INDEX idx_kobo_attachment_pending ON integration.kobo_attachment USING btree (created_at) WHERE (downloaded_at IS NULL);


--
-- Name: idx_kobo_attachment_submission; Type: INDEX; Schema: integration; Owner: -
--

CREATE INDEX idx_kobo_attachment_submission ON integration.kobo_attachment USING btree (submission_id);


--
-- Name: kobo_attachment_uk; Type: INDEX; Schema: integration; Owner: -
--

CREATE UNIQUE INDEX kobo_attachment_uk ON integration.kobo_attachment USING btree (submission_id, question_xpath, filename);


--
-- Name: kobo_submissions_raw_coop_idx; Type: INDEX; Schema: integration; Owner: -
--

CREATE INDEX kobo_submissions_raw_coop_idx ON integration.kobo_submissions_raw USING btree (cooperative_id);


--
-- Name: kobo_validation_errors_code_idx; Type: INDEX; Schema: integration; Owner: -
--

CREATE INDEX kobo_validation_errors_code_idx ON integration.kobo_validation_errors USING btree (code);


--
-- Name: kobo_validation_errors_job_key_idx; Type: INDEX; Schema: integration; Owner: -
--

CREATE INDEX kobo_validation_errors_job_key_idx ON integration.kobo_validation_errors USING btree (job_key, created_at DESC);


--
-- Name: kobo_validation_errors_kobo_uuid_idx; Type: INDEX; Schema: integration; Owner: -
--

CREATE INDEX kobo_validation_errors_kobo_uuid_idx ON integration.kobo_validation_errors USING btree (kobo_uuid);


--
-- Name: sync_cursors_uk; Type: INDEX; Schema: integration; Owner: -
--

CREATE UNIQUE INDEX sync_cursors_uk ON integration.sync_cursors USING btree (source_system, source_key);


--
-- Name: primary_evac_lot_purchases_lot_idx; Type: INDEX; Schema: primary_evacuation; Owner: -
--

CREATE INDEX primary_evac_lot_purchases_lot_idx ON primary_evacuation.lot_purchases USING btree (lot_id);


--
-- Name: primary_evac_lot_purchases_purchase_idx; Type: INDEX; Schema: primary_evacuation; Owner: -
--

CREATE INDEX primary_evac_lot_purchases_purchase_idx ON primary_evacuation.lot_purchases USING btree (purchase_id) WHERE (purchase_id IS NOT NULL);


--
-- Name: primary_evac_lots_cooperative_date_idx; Type: INDEX; Schema: primary_evacuation; Owner: -
--

CREATE INDEX primary_evac_lots_cooperative_date_idx ON primary_evacuation.lots USING btree (cooperative_id, evacuation_date DESC);


--
-- Name: primary_evac_lots_evac_date_idx; Type: INDEX; Schema: primary_evacuation; Owner: -
--

CREATE INDEX primary_evac_lots_evac_date_idx ON primary_evacuation.lots USING btree (evacuation_date DESC);


--
-- Name: primary_evac_lots_raw_data_gin; Type: INDEX; Schema: primary_evacuation; Owner: -
--

CREATE INDEX primary_evac_lots_raw_data_gin ON primary_evacuation.lots USING gin (raw_data);


--
-- Name: primary_evac_lots_station_date_idx; Type: INDEX; Schema: primary_evacuation; Owner: -
--

CREATE INDEX primary_evac_lots_station_date_idx ON primary_evacuation.lots USING btree (station_mark_number, evacuation_date DESC);


--
-- Name: primary_evac_lots_warehouse_date_idx; Type: INDEX; Schema: primary_evacuation; Owner: -
--

CREATE INDEX primary_evac_lots_warehouse_date_idx ON primary_evacuation.lots USING btree (district_warehouse, evacuation_date DESC);


--
-- Name: primary_evac_lots_waybill_idx; Type: INDEX; Schema: primary_evacuation; Owner: -
--

CREATE INDEX primary_evac_lots_waybill_idx ON primary_evacuation.lots USING btree (primary_waybill_number);


--
-- Name: cocoa_purchases_cooperative_date_idx; Type: INDEX; Schema: purchase; Owner: -
--

CREATE INDEX cocoa_purchases_cooperative_date_idx ON purchase.cocoa_purchases USING btree (cooperative_id, purchase_date DESC);


--
-- Name: cocoa_purchases_farmer_date_idx; Type: INDEX; Schema: purchase; Owner: -
--

CREATE INDEX cocoa_purchases_farmer_date_idx ON purchase.cocoa_purchases USING btree (farmer_id, purchase_date DESC) WHERE (farmer_id IS NOT NULL);


--
-- Name: cocoa_purchases_parcel_idx; Type: INDEX; Schema: purchase; Owner: -
--

CREATE INDEX cocoa_purchases_parcel_idx ON purchase.cocoa_purchases USING btree (parcel_id);


--
-- Name: cocoa_purchases_payment_type_idx; Type: INDEX; Schema: purchase; Owner: -
--

CREATE INDEX cocoa_purchases_payment_type_idx ON purchase.cocoa_purchases USING btree (payment_type);


--
-- Name: cocoa_purchases_purchase_date_idx; Type: INDEX; Schema: purchase; Owner: -
--

CREATE INDEX cocoa_purchases_purchase_date_idx ON purchase.cocoa_purchases USING btree (purchase_date DESC);


--
-- Name: cocoa_purchases_purchase_id_idx; Type: INDEX; Schema: purchase; Owner: -
--

CREATE INDEX cocoa_purchases_purchase_id_idx ON purchase.cocoa_purchases USING btree (purchase_id);


--
-- Name: cocoa_purchases_raw_data_gin; Type: INDEX; Schema: purchase; Owner: -
--

CREATE INDEX cocoa_purchases_raw_data_gin ON purchase.cocoa_purchases USING gin (raw_data);


--
-- Name: cocoa_purchases_station_date_idx; Type: INDEX; Schema: purchase; Owner: -
--

CREATE INDEX cocoa_purchases_station_date_idx ON purchase.cocoa_purchases USING btree (station_mark_number, purchase_date DESC);


--
-- Name: eudr_commodity_uk; Type: INDEX; Schema: reference; Owner: -
--

CREATE UNIQUE INDEX eudr_commodity_uk ON reference.eudr_commodity USING btree (code, source_version);


--
-- Name: eudr_country_risk_uk; Type: INDEX; Schema: reference; Owner: -
--

CREATE UNIQUE INDEX eudr_country_risk_uk ON reference.eudr_country_risk USING btree (iso2, source_version);


--
-- Name: eudr_hs_code_uk; Type: INDEX; Schema: reference; Owner: -
--

CREATE UNIQUE INDEX eudr_hs_code_uk ON reference.eudr_hs_code USING btree (code, source_version);


--
-- Name: idx_eudr_country_risk_iso2; Type: INDEX; Schema: reference; Owner: -
--

CREATE INDEX idx_eudr_country_risk_iso2 ON reference.eudr_country_risk USING btree (iso2) WHERE (retired_at IS NULL);


--
-- Name: idx_eudr_hs_code_scope; Type: INDEX; Schema: reference; Owner: -
--

CREATE INDEX idx_eudr_hs_code_scope ON reference.eudr_hs_code USING btree (cocoa_scope) WHERE (retired_at IS NULL);


--
-- Name: idx_ra_indicator_code; Type: INDEX; Schema: reference; Owner: -
--

CREATE INDEX idx_ra_indicator_code ON reference.ra_indicator USING btree (code) WHERE (retired_at IS NULL);


--
-- Name: ra_indicator_code_version_uk; Type: INDEX; Schema: reference; Owner: -
--

CREATE UNIQUE INDEX ra_indicator_code_version_uk ON reference.ra_indicator USING btree (code, source_version);


--
-- Name: dashboard_snapshots_uk; Type: INDEX; Schema: reporting; Owner: -
--

CREATE UNIQUE INDEX dashboard_snapshots_uk ON reporting.dashboard_snapshots USING btree (cooperative_id, snapshot_type, snapshot_date);


--
-- Name: inspection_cache_uk; Type: INDEX; Schema: reporting; Owner: -
--

CREATE UNIQUE INDEX inspection_cache_uk ON reporting.inspection_report_cache USING btree (cooperative_id, inspection_year);


--
-- Name: trace_cache_uk; Type: INDEX; Schema: reporting; Owner: -
--

CREATE UNIQUE INDEX trace_cache_uk ON reporting.traceability_report_cache USING btree (cooperative_id, season);


--
-- Name: secondary_evac_lot_primaries_primary_idx; Type: INDEX; Schema: secondary_evacuation; Owner: -
--

CREATE INDEX secondary_evac_lot_primaries_primary_idx ON secondary_evacuation.lot_primaries USING btree (primary_lot_id) WHERE (primary_lot_id IS NOT NULL);


--
-- Name: secondary_evac_lot_primaries_secondary_idx; Type: INDEX; Schema: secondary_evacuation; Owner: -
--

CREATE INDEX secondary_evac_lot_primaries_secondary_idx ON secondary_evacuation.lot_primaries USING btree (secondary_lot_id);


--
-- Name: secondary_evac_lots_cooperative_date_idx; Type: INDEX; Schema: secondary_evacuation; Owner: -
--

CREATE INDEX secondary_evac_lots_cooperative_date_idx ON secondary_evacuation.lots USING btree (cooperative_id, evacuation_date DESC);


--
-- Name: secondary_evac_lots_dds_status_idx; Type: INDEX; Schema: secondary_evacuation; Owner: -
--

CREATE INDEX secondary_evac_lots_dds_status_idx ON secondary_evacuation.lots USING btree (dds_status);


--
-- Name: secondary_evac_lots_depot_idx; Type: INDEX; Schema: secondary_evacuation; Owner: -
--

CREATE INDEX secondary_evac_lots_depot_idx ON secondary_evacuation.lots USING btree (depot_origin, evacuation_date DESC);


--
-- Name: secondary_evac_lots_evac_date_idx; Type: INDEX; Schema: secondary_evacuation; Owner: -
--

CREATE INDEX secondary_evac_lots_evac_date_idx ON secondary_evacuation.lots USING btree (evacuation_date DESC);


--
-- Name: secondary_evac_lots_partner_idx; Type: INDEX; Schema: secondary_evacuation; Owner: -
--

CREATE INDEX secondary_evac_lots_partner_idx ON secondary_evacuation.lots USING btree (sourcing_partner);


--
-- Name: secondary_evac_lots_port_idx; Type: INDEX; Schema: secondary_evacuation; Owner: -
--

CREATE INDEX secondary_evac_lots_port_idx ON secondary_evacuation.lots USING btree (port_destination);


--
-- Name: secondary_evac_lots_raw_data_gin; Type: INDEX; Schema: secondary_evacuation; Owner: -
--

CREATE INDEX secondary_evac_lots_raw_data_gin ON secondary_evacuation.lots USING gin (raw_data);


--
-- Name: secondary_evac_lots_waybill_idx; Type: INDEX; Schema: secondary_evacuation; Owner: -
--

CREATE INDEX secondary_evac_lots_waybill_idx ON secondary_evacuation.lots USING btree (secondary_waybill_number);


--
-- Name: shade_survival_checks_coop_parcel_uk; Type: INDEX; Schema: shade; Owner: -
--

CREATE UNIQUE INDEX shade_survival_checks_coop_parcel_uk ON shade.survival_checks USING btree (cooperative_id, parcel_id);


--
-- Name: shade_survival_checks_farmer_idx; Type: INDEX; Schema: shade; Owner: -
--

CREATE INDEX shade_survival_checks_farmer_idx ON shade.survival_checks USING btree (farmer_id);


--
-- Name: shade_survival_checks_pct_idx; Type: INDEX; Schema: shade; Owner: -
--

CREATE INDEX shade_survival_checks_pct_idx ON shade.survival_checks USING btree (survival_pct);


--
-- Name: shade_tree_profiling_coop_date_idx; Type: INDEX; Schema: shade; Owner: -
--

CREATE INDEX shade_tree_profiling_coop_date_idx ON shade.tree_profiling USING btree (cooperative_id, date_observed DESC);


--
-- Name: shade_tree_profiling_farmer_idx; Type: INDEX; Schema: shade; Owner: -
--

CREATE INDEX shade_tree_profiling_farmer_idx ON shade.tree_profiling USING btree (farmer_id);


--
-- Name: shade_tree_profiling_kobo_uuid_uk; Type: INDEX; Schema: shade; Owner: -
--

CREATE UNIQUE INDEX shade_tree_profiling_kobo_uuid_uk ON shade.tree_profiling USING btree (kobo_uuid);


--
-- Name: shade_tree_profiling_parcel_idx; Type: INDEX; Schema: shade; Owner: -
--

CREATE INDEX shade_tree_profiling_parcel_idx ON shade.tree_profiling USING btree (parcel_id);


--
-- Name: shade_tree_profiling_species_idx; Type: INDEX; Schema: shade; Owner: -
--

CREATE INDEX shade_tree_profiling_species_idx ON shade.tree_profiling USING btree (species);


--
-- Name: batch_items_uk; Type: INDEX; Schema: traceability; Owner: -
--

CREATE UNIQUE INDEX batch_items_uk ON traceability.batch_items USING btree (batch_id, purchase_id);


--
-- Name: idx_batches_active_by_coop; Type: INDEX; Schema: traceability; Owner: -
--

CREATE INDEX idx_batches_active_by_coop ON traceability.batches USING btree (cooperative_id, season) WHERE (deleted_at IS NULL);


--
-- Name: idx_purchases_active_by_farmer; Type: INDEX; Schema: traceability; Owner: -
--

CREATE INDEX idx_purchases_active_by_farmer ON traceability.purchases USING btree (farmer_id, purchase_date) WHERE (deleted_at IS NULL);


--
-- Name: trace_links_uk; Type: INDEX; Schema: traceability; Owner: -
--

CREATE UNIQUE INDEX trace_links_uk ON traceability.trace_links USING btree (batch_id, purchase_id, farmer_id, parcel_id);


--
-- Name: training_attendance_farmer_idx; Type: INDEX; Schema: training; Owner: -
--

CREATE INDEX training_attendance_farmer_idx ON training.training_attendance USING btree (farmer_id, created_at DESC) WHERE (farmer_id IS NOT NULL);


--
-- Name: training_attendance_session_idx; Type: INDEX; Schema: training; Owner: -
--

CREATE INDEX training_attendance_session_idx ON training.training_attendance USING btree (session_id);


--
-- Name: training_sessions_cooperative_date_idx; Type: INDEX; Schema: training; Owner: -
--

CREATE INDEX training_sessions_cooperative_date_idx ON training.training_sessions USING btree (cooperative_id, training_date DESC);


--
-- Name: training_sessions_raw_data_gin; Type: INDEX; Schema: training; Owner: -
--

CREATE INDEX training_sessions_raw_data_gin ON training.training_sessions USING gin (raw_data);


--
-- Name: training_sessions_training_date_idx; Type: INDEX; Schema: training; Owner: -
--

CREATE INDEX training_sessions_training_date_idx ON training.training_sessions USING btree (training_date DESC);


--
-- Name: vsla_groups_coop_idx; Type: INDEX; Schema: vsla; Owner: -
--

CREATE INDEX vsla_groups_coop_idx ON vsla.groups USING btree (cooperative_id);


--
-- Name: vsla_groups_enumerator_prefix_idx; Type: INDEX; Schema: vsla; Owner: -
--

CREATE INDEX vsla_groups_enumerator_prefix_idx ON vsla.groups USING btree (enumerator_prefix);


--
-- Name: vsla_groups_latest_report_month_idx; Type: INDEX; Schema: vsla; Owner: -
--

CREATE INDEX vsla_groups_latest_report_month_idx ON vsla.groups USING btree (latest_report_month DESC NULLS LAST);


--
-- Name: vsla_groups_natural_key_uk; Type: INDEX; Schema: vsla; Owner: -
--

CREATE UNIQUE INDEX vsla_groups_natural_key_uk ON vsla.groups USING btree (natural_key);


--
-- Name: vsla_monthly_reports_coop_idx; Type: INDEX; Schema: vsla; Owner: -
--

CREATE INDEX vsla_monthly_reports_coop_idx ON vsla.monthly_reports USING btree (cooperative_id);


--
-- Name: vsla_monthly_reports_group_month_idx; Type: INDEX; Schema: vsla; Owner: -
--

CREATE INDEX vsla_monthly_reports_group_month_idx ON vsla.monthly_reports USING btree (group_id, report_month DESC);


--
-- Name: vsla_monthly_reports_has_discrepancy_idx; Type: INDEX; Schema: vsla; Owner: -
--

CREATE INDEX vsla_monthly_reports_has_discrepancy_idx ON vsla.monthly_reports USING btree (has_discrepancy) WHERE (has_discrepancy = true);


--
-- Name: vsla_monthly_reports_kobo_uuid_uk; Type: INDEX; Schema: vsla; Owner: -
--

CREATE UNIQUE INDEX vsla_monthly_reports_kobo_uuid_uk ON vsla.monthly_reports USING btree (kobo_uuid);


--
-- Name: audit_logs audit_logs_notify; Type: TRIGGER; Schema: audit; Owner: -
--

CREATE TRIGGER audit_logs_notify AFTER INSERT ON audit.audit_logs FOR EACH ROW EXECUTE FUNCTION audit.notify_audit_event();


--
-- Name: farmers trg_farmers_notify_projection; Type: TRIGGER; Schema: farmer; Owner: -
--

CREATE TRIGGER trg_farmers_notify_projection AFTER INSERT OR DELETE OR UPDATE ON farmer.farmers FOR EACH ROW EXECUTE FUNCTION public.notify_projection_invalidate();


--
-- Name: farmers trg_farmers_set_updated_at; Type: TRIGGER; Schema: farmer; Owner: -
--

CREATE TRIGGER trg_farmers_set_updated_at BEFORE UPDATE ON farmer.farmers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: household_members trg_household_members_set_updated_at; Type: TRIGGER; Schema: farmer; Owner: -
--

CREATE TRIGGER trg_household_members_set_updated_at BEFORE UPDATE ON farmer.household_members FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: coaching_reports trg_coaching_reports_set_updated_at; Type: TRIGGER; Schema: field_ops; Owner: -
--

CREATE TRIGGER trg_coaching_reports_set_updated_at BEFORE UPDATE ON field_ops.coaching_reports FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: coaching_visits trg_coaching_visits_set_updated_at; Type: TRIGGER; Schema: field_ops; Owner: -
--

CREATE TRIGGER trg_coaching_visits_set_updated_at BEFORE UPDATE ON field_ops.coaching_visits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: farm_development_plans trg_farm_development_plans_set_updated_at; Type: TRIGGER; Schema: field_ops; Owner: -
--

CREATE TRIGGER trg_farm_development_plans_set_updated_at BEFORE UPDATE ON field_ops.farm_development_plans FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: follow_up_actions trg_follow_up_actions_set_updated_at; Type: TRIGGER; Schema: field_ops; Owner: -
--

CREATE TRIGGER trg_follow_up_actions_set_updated_at BEFORE UPDATE ON field_ops.follow_up_actions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: inspection_findings trg_inspection_findings_notify_projection; Type: TRIGGER; Schema: field_ops; Owner: -
--

CREATE TRIGGER trg_inspection_findings_notify_projection AFTER INSERT OR DELETE OR UPDATE ON field_ops.inspection_findings FOR EACH ROW EXECUTE FUNCTION public.notify_projection_invalidate();


--
-- Name: inspection_findings trg_inspection_findings_set_updated_at; Type: TRIGGER; Schema: field_ops; Owner: -
--

CREATE TRIGGER trg_inspection_findings_set_updated_at BEFORE UPDATE ON field_ops.inspection_findings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: inspections trg_inspections_notify_projection; Type: TRIGGER; Schema: field_ops; Owner: -
--

CREATE TRIGGER trg_inspections_notify_projection AFTER INSERT OR DELETE OR UPDATE ON field_ops.inspections FOR EACH ROW EXECUTE FUNCTION public.notify_projection_invalidate();


--
-- Name: inspections trg_inspections_set_updated_at; Type: TRIGGER; Schema: field_ops; Owner: -
--

CREATE TRIGGER trg_inspections_set_updated_at BEFORE UPDATE ON field_ops.inspections FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: training_modules trg_training_modules_set_updated_at; Type: TRIGGER; Schema: field_ops; Owner: -
--

CREATE TRIGGER trg_training_modules_set_updated_at BEFORE UPDATE ON field_ops.training_modules FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: training_sessions trg_training_sessions_set_updated_at; Type: TRIGGER; Schema: field_ops; Owner: -
--

CREATE TRIGGER trg_training_sessions_set_updated_at BEFORE UPDATE ON field_ops.training_sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: eudr_status trg_eudr_status_notify_projection; Type: TRIGGER; Schema: gis; Owner: -
--

CREATE TRIGGER trg_eudr_status_notify_projection AFTER INSERT OR DELETE OR UPDATE ON gis.eudr_status FOR EACH ROW EXECUTE FUNCTION public.notify_projection_invalidate();


--
-- Name: eudr_status trg_eudr_status_set_updated_at; Type: TRIGGER; Schema: gis; Owner: -
--

CREATE TRIGGER trg_eudr_status_set_updated_at BEFORE UPDATE ON gis.eudr_status FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: geo_import_jobs trg_geo_import_jobs_set_updated_at; Type: TRIGGER; Schema: gis; Owner: -
--

CREATE TRIGGER trg_geo_import_jobs_set_updated_at BEFORE UPDATE ON gis.geo_import_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: parcel_characteristics trg_parcel_characteristics_set_updated_at; Type: TRIGGER; Schema: gis; Owner: -
--

CREATE TRIGGER trg_parcel_characteristics_set_updated_at BEFORE UPDATE ON gis.parcel_characteristics FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: parcels trg_parcels_notify_projection; Type: TRIGGER; Schema: gis; Owner: -
--

CREATE TRIGGER trg_parcels_notify_projection AFTER INSERT OR DELETE OR UPDATE ON gis.parcels FOR EACH ROW EXECUTE FUNCTION public.notify_projection_invalidate();


--
-- Name: parcels trg_parcels_set_updated_at; Type: TRIGGER; Schema: gis; Owner: -
--

CREATE TRIGGER trg_parcels_set_updated_at BEFORE UPDATE ON gis.parcels FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: accounts trg_accounts_set_updated_at; Type: TRIGGER; Schema: iam; Owner: -
--

CREATE TRIGGER trg_accounts_set_updated_at BEFORE UPDATE ON iam.accounts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: cooperatives trg_cooperatives_set_updated_at; Type: TRIGGER; Schema: iam; Owner: -
--

CREATE TRIGGER trg_cooperatives_set_updated_at BEFORE UPDATE ON iam.cooperatives FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: roles trg_roles_set_updated_at; Type: TRIGGER; Schema: iam; Owner: -
--

CREATE TRIGGER trg_roles_set_updated_at BEFORE UPDATE ON iam.roles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sessions trg_sessions_set_updated_at; Type: TRIGGER; Schema: iam; Owner: -
--

CREATE TRIGGER trg_sessions_set_updated_at BEFORE UPDATE ON iam.sessions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: users trg_users_set_updated_at; Type: TRIGGER; Schema: iam; Owner: -
--

CREATE TRIGGER trg_users_set_updated_at BEFORE UPDATE ON iam.users FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: verifications trg_verifications_set_updated_at; Type: TRIGGER; Schema: iam; Owner: -
--

CREATE TRIGGER trg_verifications_set_updated_at BEFORE UPDATE ON iam.verifications FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: kobo_attachment trg_kobo_attachment_set_updated_at; Type: TRIGGER; Schema: integration; Owner: -
--

CREATE TRIGGER trg_kobo_attachment_set_updated_at BEFORE UPDATE ON integration.kobo_attachment FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: migration_jobs trg_migration_jobs_set_updated_at; Type: TRIGGER; Schema: integration; Owner: -
--

CREATE TRIGGER trg_migration_jobs_set_updated_at BEFORE UPDATE ON integration.migration_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sync_cursors trg_sync_cursors_set_updated_at; Type: TRIGGER; Schema: integration; Owner: -
--

CREATE TRIGGER trg_sync_cursors_set_updated_at BEFORE UPDATE ON integration.sync_cursors FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: sync_jobs trg_sync_jobs_set_updated_at; Type: TRIGGER; Schema: integration; Owner: -
--

CREATE TRIGGER trg_sync_jobs_set_updated_at BEFORE UPDATE ON integration.sync_jobs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: eudr_commodity trg_eudr_commodity_set_updated_at; Type: TRIGGER; Schema: reference; Owner: -
--

CREATE TRIGGER trg_eudr_commodity_set_updated_at BEFORE UPDATE ON reference.eudr_commodity FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: eudr_country_risk trg_eudr_country_risk_set_updated_at; Type: TRIGGER; Schema: reference; Owner: -
--

CREATE TRIGGER trg_eudr_country_risk_set_updated_at BEFORE UPDATE ON reference.eudr_country_risk FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: eudr_hs_code trg_eudr_hs_code_set_updated_at; Type: TRIGGER; Schema: reference; Owner: -
--

CREATE TRIGGER trg_eudr_hs_code_set_updated_at BEFORE UPDATE ON reference.eudr_hs_code FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: ra_indicator trg_ra_indicator_set_updated_at; Type: TRIGGER; Schema: reference; Owner: -
--

CREATE TRIGGER trg_ra_indicator_set_updated_at BEFORE UPDATE ON reference.ra_indicator FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: report_runs trg_report_runs_set_updated_at; Type: TRIGGER; Schema: reporting; Owner: -
--

CREATE TRIGGER trg_report_runs_set_updated_at BEFORE UPDATE ON reporting.report_runs FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: batches trg_batches_notify_projection; Type: TRIGGER; Schema: traceability; Owner: -
--

CREATE TRIGGER trg_batches_notify_projection AFTER INSERT OR DELETE OR UPDATE ON traceability.batches FOR EACH ROW EXECUTE FUNCTION public.notify_projection_invalidate();


--
-- Name: batches trg_batches_set_updated_at; Type: TRIGGER; Schema: traceability; Owner: -
--

CREATE TRIGGER trg_batches_set_updated_at BEFORE UPDATE ON traceability.batches FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: purchases trg_purchases_notify_projection; Type: TRIGGER; Schema: traceability; Owner: -
--

CREATE TRIGGER trg_purchases_notify_projection AFTER INSERT OR DELETE OR UPDATE ON traceability.purchases FOR EACH ROW EXECUTE FUNCTION public.notify_projection_invalidate();


--
-- Name: purchases trg_purchases_set_updated_at; Type: TRIGGER; Schema: traceability; Owner: -
--

CREATE TRIGGER trg_purchases_set_updated_at BEFORE UPDATE ON traceability.purchases FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


--
-- Name: audit_attachment audit_attachment_audit_log_id_fkey; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.audit_attachment
    ADD CONSTRAINT audit_attachment_audit_log_id_fkey FOREIGN KEY (audit_log_id) REFERENCES audit.audit_logs(id) ON DELETE CASCADE;


--
-- Name: audit_logs audit_logs_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.audit_logs
    ADD CONSTRAINT audit_logs_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.audit_logs
    ADD CONSTRAINT audit_logs_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE SET NULL;


--
-- Name: report_audit_logs report_audit_logs_actor_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.report_audit_logs
    ADD CONSTRAINT report_audit_logs_actor_user_id_users_id_fk FOREIGN KEY (actor_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: report_audit_logs report_audit_logs_report_run_id_report_runs_id_fk; Type: FK CONSTRAINT; Schema: audit; Owner: -
--

ALTER TABLE ONLY audit.report_audit_logs
    ADD CONSTRAINT report_audit_logs_report_run_id_report_runs_id_fk FOREIGN KEY (report_run_id) REFERENCES reporting.report_runs(id) ON DELETE SET NULL;


--
-- Name: coaching_visits coaching_visits_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: coaching; Owner: -
--

ALTER TABLE ONLY coaching.coaching_visits
    ADD CONSTRAINT coaching_visits_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: coaching_visits coaching_visits_farmer_id_fkey; Type: FK CONSTRAINT; Schema: coaching; Owner: -
--

ALTER TABLE ONLY coaching.coaching_visits
    ADD CONSTRAINT coaching_visits_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id);


--
-- Name: coaching_visits coaching_visits_parcel_id_fkey; Type: FK CONSTRAINT; Schema: coaching; Owner: -
--

ALTER TABLE ONLY coaching.coaching_visits
    ADD CONSTRAINT coaching_visits_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES gis.parcels(id);


--
-- Name: farmer_photos farmer_photos_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.farmer_photos
    ADD CONSTRAINT farmer_photos_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE CASCADE;


--
-- Name: farmer_photos farmer_photos_uploaded_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.farmer_photos
    ADD CONSTRAINT farmer_photos_uploaded_by_user_id_users_id_fk FOREIGN KEY (uploaded_by_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: farmers farmers_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.farmers
    ADD CONSTRAINT farmers_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE RESTRICT;


--
-- Name: farmers farmers_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.farmers
    ADD CONSTRAINT farmers_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: household_members household_members_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.household_members
    ADD CONSTRAINT household_members_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: household_members household_members_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.household_members
    ADD CONSTRAINT household_members_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE CASCADE;


--
-- Name: profile_change_history profile_change_history_changed_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.profile_change_history
    ADD CONSTRAINT profile_change_history_changed_by_user_id_users_id_fk FOREIGN KEY (changed_by_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: profile_change_history profile_change_history_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: farmer; Owner: -
--

ALTER TABLE ONLY farmer.profile_change_history
    ADD CONSTRAINT profile_change_history_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE CASCADE;


--
-- Name: coaching_reports coaching_reports_coaching_visit_id_coaching_visits_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.coaching_reports
    ADD CONSTRAINT coaching_reports_coaching_visit_id_coaching_visits_id_fk FOREIGN KEY (coaching_visit_id) REFERENCES field_ops.coaching_visits(id) ON DELETE CASCADE;


--
-- Name: coaching_visits coaching_visits_coach_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.coaching_visits
    ADD CONSTRAINT coaching_visits_coach_user_id_users_id_fk FOREIGN KEY (coach_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: coaching_visits coaching_visits_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.coaching_visits
    ADD CONSTRAINT coaching_visits_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE RESTRICT;


--
-- Name: coaching_visits coaching_visits_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.coaching_visits
    ADD CONSTRAINT coaching_visits_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: coaching_visits coaching_visits_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.coaching_visits
    ADD CONSTRAINT coaching_visits_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE RESTRICT;


--
-- Name: farm_development_plans farm_development_plans_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.farm_development_plans
    ADD CONSTRAINT farm_development_plans_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE RESTRICT;


--
-- Name: farm_development_plans farm_development_plans_created_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.farm_development_plans
    ADD CONSTRAINT farm_development_plans_created_by_user_id_users_id_fk FOREIGN KEY (created_by_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: farm_development_plans farm_development_plans_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.farm_development_plans
    ADD CONSTRAINT farm_development_plans_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: farm_development_plans farm_development_plans_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.farm_development_plans
    ADD CONSTRAINT farm_development_plans_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE RESTRICT;


--
-- Name: follow_up_actions follow_up_actions_assigned_to_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.follow_up_actions
    ADD CONSTRAINT follow_up_actions_assigned_to_user_id_users_id_fk FOREIGN KEY (assigned_to_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: follow_up_actions follow_up_actions_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.follow_up_actions
    ADD CONSTRAINT follow_up_actions_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE RESTRICT;


--
-- Name: follow_up_actions follow_up_actions_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.follow_up_actions
    ADD CONSTRAINT follow_up_actions_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE RESTRICT;


--
-- Name: follow_up_actions follow_up_actions_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.follow_up_actions
    ADD CONSTRAINT follow_up_actions_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES field_ops.inspections(id) ON DELETE SET NULL;


--
-- Name: inspection_findings inspection_findings_inspection_id_inspections_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.inspection_findings
    ADD CONSTRAINT inspection_findings_inspection_id_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES field_ops.inspections(id) ON DELETE CASCADE;


--
-- Name: inspection_findings inspection_findings_ra_indicator_id_fkey; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.inspection_findings
    ADD CONSTRAINT inspection_findings_ra_indicator_id_fkey FOREIGN KEY (ra_indicator_id) REFERENCES reference.ra_indicator(id) ON DELETE SET NULL;


--
-- Name: inspections inspections_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.inspections
    ADD CONSTRAINT inspections_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE RESTRICT;


--
-- Name: inspections inspections_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.inspections
    ADD CONSTRAINT inspections_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: inspections inspections_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.inspections
    ADD CONSTRAINT inspections_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE RESTRICT;


--
-- Name: inspections inspections_inspector_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.inspections
    ADD CONSTRAINT inspections_inspector_user_id_users_id_fk FOREIGN KEY (inspector_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: training_attendance training_attendance_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_attendance
    ADD CONSTRAINT training_attendance_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE RESTRICT;


--
-- Name: training_attendance training_attendance_session_id_training_sessions_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_attendance
    ADD CONSTRAINT training_attendance_session_id_training_sessions_id_fk FOREIGN KEY (session_id) REFERENCES field_ops.training_sessions(id) ON DELETE CASCADE;


--
-- Name: training_modules training_modules_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_modules
    ADD CONSTRAINT training_modules_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE SET NULL;


--
-- Name: training_modules training_modules_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_modules
    ADD CONSTRAINT training_modules_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: training_sessions training_sessions_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_sessions
    ADD CONSTRAINT training_sessions_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE RESTRICT;


--
-- Name: training_sessions training_sessions_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_sessions
    ADD CONSTRAINT training_sessions_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: training_sessions training_sessions_facilitator_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_sessions
    ADD CONSTRAINT training_sessions_facilitator_user_id_users_id_fk FOREIGN KEY (facilitator_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: training_sessions training_sessions_module_id_training_modules_id_fk; Type: FK CONSTRAINT; Schema: field_ops; Owner: -
--

ALTER TABLE ONLY field_ops.training_sessions
    ADD CONSTRAINT training_sessions_module_id_training_modules_id_fk FOREIGN KEY (module_id) REFERENCES field_ops.training_modules(id) ON DELETE RESTRICT;


--
-- Name: eudr_status eudr_status_country_risk_id_fkey; Type: FK CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.eudr_status
    ADD CONSTRAINT eudr_status_country_risk_id_fkey FOREIGN KEY (country_risk_id) REFERENCES reference.eudr_country_risk(id) ON DELETE SET NULL;


--
-- Name: eudr_status eudr_status_parcel_id_parcels_id_fk; Type: FK CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.eudr_status
    ADD CONSTRAINT eudr_status_parcel_id_parcels_id_fk FOREIGN KEY (parcel_id) REFERENCES gis.parcels(id) ON DELETE CASCADE;


--
-- Name: parcel_characteristics parcel_characteristics_parcel_id_parcels_id_fk; Type: FK CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcel_characteristics
    ADD CONSTRAINT parcel_characteristics_parcel_id_parcels_id_fk FOREIGN KEY (parcel_id) REFERENCES gis.parcels(id) ON DELETE CASCADE;


--
-- Name: parcel_geometries parcel_geometries_import_job_id_geo_import_jobs_id_fk; Type: FK CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcel_geometries
    ADD CONSTRAINT parcel_geometries_import_job_id_geo_import_jobs_id_fk FOREIGN KEY (import_job_id) REFERENCES gis.geo_import_jobs(id) ON DELETE SET NULL;


--
-- Name: parcel_geometries parcel_geometries_parcel_id_parcels_id_fk; Type: FK CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcel_geometries
    ADD CONSTRAINT parcel_geometries_parcel_id_parcels_id_fk FOREIGN KEY (parcel_id) REFERENCES gis.parcels(id) ON DELETE CASCADE;


--
-- Name: parcel_overlap_flags parcel_overlap_flags_nearby_parcel_id_parcels_id_fk; Type: FK CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcel_overlap_flags
    ADD CONSTRAINT parcel_overlap_flags_nearby_parcel_id_parcels_id_fk FOREIGN KEY (nearby_parcel_id) REFERENCES gis.parcels(id) ON DELETE CASCADE;


--
-- Name: parcel_overlap_flags parcel_overlap_flags_parcel_id_parcels_id_fk; Type: FK CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcel_overlap_flags
    ADD CONSTRAINT parcel_overlap_flags_parcel_id_parcels_id_fk FOREIGN KEY (parcel_id) REFERENCES gis.parcels(id) ON DELETE CASCADE;


--
-- Name: parcels parcels_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcels
    ADD CONSTRAINT parcels_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE RESTRICT;


--
-- Name: parcels parcels_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcels
    ADD CONSTRAINT parcels_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: parcels parcels_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: gis; Owner: -
--

ALTER TABLE ONLY gis.parcels
    ADD CONSTRAINT parcels_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE RESTRICT;


--
-- Name: accounts accounts_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.accounts
    ADD CONSTRAINT accounts_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES iam.users(id) ON DELETE CASCADE;


--
-- Name: cooperatives cooperatives_chair_user_id_fk; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.cooperatives
    ADD CONSTRAINT cooperatives_chair_user_id_fk FOREIGN KEY (chair_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: role_permissions role_permissions_permission_id_permissions_id_fk; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_permissions_id_fk FOREIGN KEY (permission_id) REFERENCES iam.permissions(id) ON DELETE CASCADE;


--
-- Name: role_permissions role_permissions_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.role_permissions
    ADD CONSTRAINT role_permissions_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES iam.roles(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.sessions
    ADD CONSTRAINT sessions_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES iam.users(id) ON DELETE CASCADE;


--
-- Name: user_cooperative_assignments user_cooperative_assignments_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_cooperative_assignments
    ADD CONSTRAINT user_cooperative_assignments_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE CASCADE;


--
-- Name: user_cooperative_assignments user_cooperative_assignments_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_cooperative_assignments
    ADD CONSTRAINT user_cooperative_assignments_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES iam.users(id) ON DELETE CASCADE;


--
-- Name: user_notification_pref user_notification_pref_user_id_fkey; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_notification_pref
    ADD CONSTRAINT user_notification_pref_user_id_fkey FOREIGN KEY (user_id) REFERENCES iam.users(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_roles_id_fk; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_roles
    ADD CONSTRAINT user_roles_role_id_roles_id_fk FOREIGN KEY (role_id) REFERENCES iam.roles(id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.user_roles
    ADD CONSTRAINT user_roles_user_id_users_id_fk FOREIGN KEY (user_id) REFERENCES iam.users(id) ON DELETE CASCADE;


--
-- Name: users users_default_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: iam; Owner: -
--

ALTER TABLE ONLY iam.users
    ADD CONSTRAINT users_default_cooperative_id_cooperatives_id_fk FOREIGN KEY (default_cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE SET NULL;


--
-- Name: attachments attachments_inspection_id_inspection_inspections_id_fk; Type: FK CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.attachments
    ADD CONSTRAINT attachments_inspection_id_inspection_inspections_id_fk FOREIGN KEY (inspection_id) REFERENCES inspection.inspections(id) ON DELETE CASCADE;


--
-- Name: corrective_actions corrective_actions_coaching_visit_fk; Type: FK CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.corrective_actions
    ADD CONSTRAINT corrective_actions_coaching_visit_fk FOREIGN KEY (coaching_visit_id) REFERENCES coaching.coaching_visits(id) ON DELETE CASCADE;


--
-- Name: corrective_actions corrective_actions_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.corrective_actions
    ADD CONSTRAINT corrective_actions_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: corrective_actions corrective_actions_farmer_id_fkey; Type: FK CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.corrective_actions
    ADD CONSTRAINT corrective_actions_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id);


--
-- Name: corrective_actions corrective_actions_inspection_id_fkey; Type: FK CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.corrective_actions
    ADD CONSTRAINT corrective_actions_inspection_id_fkey FOREIGN KEY (inspection_id) REFERENCES inspection.inspections(id) ON DELETE CASCADE;


--
-- Name: corrective_actions corrective_actions_parcel_id_fkey; Type: FK CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.corrective_actions
    ADD CONSTRAINT corrective_actions_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES gis.parcels(id);


--
-- Name: inspections inspections_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.inspections
    ADD CONSTRAINT inspections_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: inspections inspections_farmer_id_fkey; Type: FK CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.inspections
    ADD CONSTRAINT inspections_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id);


--
-- Name: inspections inspections_parcel_id_fkey; Type: FK CONSTRAINT; Schema: inspection; Owner: -
--

ALTER TABLE ONLY inspection.inspections
    ADD CONSTRAINT inspections_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES gis.parcels(id);


--
-- Name: attachment_link attachment_link_attachment_id_kobo_attachment_id_fk; Type: FK CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.attachment_link
    ADD CONSTRAINT attachment_link_attachment_id_kobo_attachment_id_fk FOREIGN KEY (attachment_id) REFERENCES integration.kobo_attachment(id) ON DELETE CASCADE;


--
-- Name: attachment_link attachment_link_linked_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.attachment_link
    ADD CONSTRAINT attachment_link_linked_by_user_id_users_id_fk FOREIGN KEY (linked_by_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: kobo_attachment kobo_attachment_submission_id_kobo_submissions_raw_id_fk; Type: FK CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.kobo_attachment
    ADD CONSTRAINT kobo_attachment_submission_id_kobo_submissions_raw_id_fk FOREIGN KEY (submission_id) REFERENCES integration.kobo_submissions_raw(id) ON DELETE CASCADE;


--
-- Name: kobo_submissions_raw kobo_submissions_raw_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.kobo_submissions_raw
    ADD CONSTRAINT kobo_submissions_raw_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE SET NULL;


--
-- Name: reconciliation_results reconciliation_results_migration_job_id_migration_jobs_id_fk; Type: FK CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.reconciliation_results
    ADD CONSTRAINT reconciliation_results_migration_job_id_migration_jobs_id_fk FOREIGN KEY (migration_job_id) REFERENCES integration.migration_jobs(id) ON DELETE CASCADE;


--
-- Name: sync_errors sync_errors_sync_job_id_sync_jobs_id_fk; Type: FK CONSTRAINT; Schema: integration; Owner: -
--

ALTER TABLE ONLY integration.sync_errors
    ADD CONSTRAINT sync_errors_sync_job_id_sync_jobs_id_fk FOREIGN KEY (sync_job_id) REFERENCES integration.sync_jobs(id) ON DELETE SET NULL;


--
-- Name: lot_purchases lot_purchases_lot_id_fkey; Type: FK CONSTRAINT; Schema: primary_evacuation; Owner: -
--

ALTER TABLE ONLY primary_evacuation.lot_purchases
    ADD CONSTRAINT lot_purchases_lot_id_fkey FOREIGN KEY (lot_id) REFERENCES primary_evacuation.lots(id) ON DELETE CASCADE;


--
-- Name: lot_purchases lot_purchases_purchase_id_fkey; Type: FK CONSTRAINT; Schema: primary_evacuation; Owner: -
--

ALTER TABLE ONLY primary_evacuation.lot_purchases
    ADD CONSTRAINT lot_purchases_purchase_id_fkey FOREIGN KEY (purchase_id) REFERENCES purchase.cocoa_purchases(id);


--
-- Name: lots lots_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: primary_evacuation; Owner: -
--

ALTER TABLE ONLY primary_evacuation.lots
    ADD CONSTRAINT lots_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: cocoa_purchases cocoa_purchases_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: purchase; Owner: -
--

ALTER TABLE ONLY purchase.cocoa_purchases
    ADD CONSTRAINT cocoa_purchases_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: cocoa_purchases cocoa_purchases_farmer_id_fkey; Type: FK CONSTRAINT; Schema: purchase; Owner: -
--

ALTER TABLE ONLY purchase.cocoa_purchases
    ADD CONSTRAINT cocoa_purchases_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id);


--
-- Name: cocoa_purchases cocoa_purchases_parcel_id_fkey; Type: FK CONSTRAINT; Schema: purchase; Owner: -
--

ALTER TABLE ONLY purchase.cocoa_purchases
    ADD CONSTRAINT cocoa_purchases_parcel_id_fkey FOREIGN KEY (parcel_id) REFERENCES gis.parcels(id);


--
-- Name: dashboard_snapshots dashboard_snapshots_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.dashboard_snapshots
    ADD CONSTRAINT dashboard_snapshots_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE SET NULL;


--
-- Name: inspection_report_cache inspection_report_cache_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.inspection_report_cache
    ADD CONSTRAINT inspection_report_cache_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE SET NULL;


--
-- Name: report_files report_files_report_run_id_report_runs_id_fk; Type: FK CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.report_files
    ADD CONSTRAINT report_files_report_run_id_report_runs_id_fk FOREIGN KEY (report_run_id) REFERENCES reporting.report_runs(id) ON DELETE CASCADE;


--
-- Name: report_runs report_runs_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.report_runs
    ADD CONSTRAINT report_runs_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE SET NULL;


--
-- Name: report_runs report_runs_requested_by_user_id_users_id_fk; Type: FK CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.report_runs
    ADD CONSTRAINT report_runs_requested_by_user_id_users_id_fk FOREIGN KEY (requested_by_user_id) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: traceability_report_cache traceability_report_cache_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: reporting; Owner: -
--

ALTER TABLE ONLY reporting.traceability_report_cache
    ADD CONSTRAINT traceability_report_cache_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE SET NULL;


--
-- Name: lot_primaries lot_primaries_primary_lot_id_fkey; Type: FK CONSTRAINT; Schema: secondary_evacuation; Owner: -
--

ALTER TABLE ONLY secondary_evacuation.lot_primaries
    ADD CONSTRAINT lot_primaries_primary_lot_id_fkey FOREIGN KEY (primary_lot_id) REFERENCES primary_evacuation.lots(id);


--
-- Name: lot_primaries lot_primaries_secondary_lot_id_fkey; Type: FK CONSTRAINT; Schema: secondary_evacuation; Owner: -
--

ALTER TABLE ONLY secondary_evacuation.lot_primaries
    ADD CONSTRAINT lot_primaries_secondary_lot_id_fkey FOREIGN KEY (secondary_lot_id) REFERENCES secondary_evacuation.lots(id) ON DELETE CASCADE;


--
-- Name: lots lots_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: secondary_evacuation; Owner: -
--

ALTER TABLE ONLY secondary_evacuation.lots
    ADD CONSTRAINT lots_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: survival_checks survival_checks_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: shade; Owner: -
--

ALTER TABLE ONLY shade.survival_checks
    ADD CONSTRAINT survival_checks_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: tree_profiling tree_profiling_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: shade; Owner: -
--

ALTER TABLE ONLY shade.tree_profiling
    ADD CONSTRAINT tree_profiling_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: batch_items batch_items_batch_id_batches_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.batch_items
    ADD CONSTRAINT batch_items_batch_id_batches_id_fk FOREIGN KEY (batch_id) REFERENCES traceability.batches(id) ON DELETE CASCADE;


--
-- Name: batch_items batch_items_purchase_id_purchases_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.batch_items
    ADD CONSTRAINT batch_items_purchase_id_purchases_id_fk FOREIGN KEY (purchase_id) REFERENCES traceability.purchases(id) ON DELETE CASCADE;


--
-- Name: batches batches_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.batches
    ADD CONSTRAINT batches_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE RESTRICT;


--
-- Name: batches batches_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.batches
    ADD CONSTRAINT batches_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: purchases purchases_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.purchases
    ADD CONSTRAINT purchases_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE RESTRICT;


--
-- Name: purchases purchases_deleted_by_users_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.purchases
    ADD CONSTRAINT purchases_deleted_by_users_id_fk FOREIGN KEY (deleted_by) REFERENCES iam.users(id) ON DELETE SET NULL;


--
-- Name: purchases purchases_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.purchases
    ADD CONSTRAINT purchases_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE RESTRICT;


--
-- Name: purchases purchases_parcel_id_parcels_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.purchases
    ADD CONSTRAINT purchases_parcel_id_parcels_id_fk FOREIGN KEY (parcel_id) REFERENCES gis.parcels(id) ON DELETE SET NULL;


--
-- Name: trace_links trace_links_batch_id_batches_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.trace_links
    ADD CONSTRAINT trace_links_batch_id_batches_id_fk FOREIGN KEY (batch_id) REFERENCES traceability.batches(id) ON DELETE CASCADE;


--
-- Name: trace_links trace_links_cooperative_id_cooperatives_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.trace_links
    ADD CONSTRAINT trace_links_cooperative_id_cooperatives_id_fk FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id) ON DELETE RESTRICT;


--
-- Name: trace_links trace_links_farmer_id_farmers_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.trace_links
    ADD CONSTRAINT trace_links_farmer_id_farmers_id_fk FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id) ON DELETE RESTRICT;


--
-- Name: trace_links trace_links_parcel_id_parcels_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.trace_links
    ADD CONSTRAINT trace_links_parcel_id_parcels_id_fk FOREIGN KEY (parcel_id) REFERENCES gis.parcels(id) ON DELETE SET NULL;


--
-- Name: trace_links trace_links_purchase_id_purchases_id_fk; Type: FK CONSTRAINT; Schema: traceability; Owner: -
--

ALTER TABLE ONLY traceability.trace_links
    ADD CONSTRAINT trace_links_purchase_id_purchases_id_fk FOREIGN KEY (purchase_id) REFERENCES traceability.purchases(id) ON DELETE CASCADE;


--
-- Name: training_attendance training_attendance_farmer_id_fkey; Type: FK CONSTRAINT; Schema: training; Owner: -
--

ALTER TABLE ONLY training.training_attendance
    ADD CONSTRAINT training_attendance_farmer_id_fkey FOREIGN KEY (farmer_id) REFERENCES farmer.farmers(id);


--
-- Name: training_attendance training_attendance_session_id_fkey; Type: FK CONSTRAINT; Schema: training; Owner: -
--

ALTER TABLE ONLY training.training_attendance
    ADD CONSTRAINT training_attendance_session_id_fkey FOREIGN KEY (session_id) REFERENCES training.training_sessions(id) ON DELETE CASCADE;


--
-- Name: training_sessions training_sessions_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: training; Owner: -
--

ALTER TABLE ONLY training.training_sessions
    ADD CONSTRAINT training_sessions_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: groups groups_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: vsla; Owner: -
--

ALTER TABLE ONLY vsla.groups
    ADD CONSTRAINT groups_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: monthly_reports monthly_reports_cooperative_id_fkey; Type: FK CONSTRAINT; Schema: vsla; Owner: -
--

ALTER TABLE ONLY vsla.monthly_reports
    ADD CONSTRAINT monthly_reports_cooperative_id_fkey FOREIGN KEY (cooperative_id) REFERENCES iam.cooperatives(id);


--
-- Name: monthly_reports monthly_reports_group_id_fkey; Type: FK CONSTRAINT; Schema: vsla; Owner: -
--

ALTER TABLE ONLY vsla.monthly_reports
    ADD CONSTRAINT monthly_reports_group_id_fkey FOREIGN KEY (group_id) REFERENCES vsla.groups(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--



--> statement-breakpoint
-- ── integration.sync_settings config (Kobo schedulers) ───────────────
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('cb4cafe9-d8b4-4048-b118-66448d80f974', 'yield_estimation', 'Yield Estimation', 'https://kf.kobotoolbox.org/api/v2/assets/aJf7o5qQUdLHXHxU2SPXU2/data/?format=json', '{}', false, 1440, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Per-farm yield assessment — area, tree count + density, productive trees, and projected harvest for the next season.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('379eda21-0339-4fe1-9144-4eb970543707', 'internal_inspection', 'Internal Inspection', 'https://kf.kobotoolbox.org/api/v2/assets/atvYAbbMA2jfvHVQGwSEFi/data/?format=json', '{"plotId": "Member/PlotID", "society": "Member/society", "cooperative": "Member/coop", "fieldSizeHa": "Member/FieldSize", "gpsLocation": "Member/Gps_location", "submittedAt": "_submission_time", "producerCode": "Member/producerId", "producerName": "Member/producer", "inspectorName": "InspectorName", "inspectionDate": "DateInspection", "submissionUuid": "_uuid"}', true, 180, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Annual field audit per farmer + parcel — Rainforest Alliance gate checks, GAP/IPM/GEP/GSP scoring, EUDR risk verdict, and corrective-action capture.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('d1ea99eb-a06c-4f44-9fda-802040129f43', 'farmer_registration', 'Farmer Registration', 'https://kf.kobotoolbox.org/api/v2/assets/aTKaHAQs3uemRjaPGUkbvX/data/?format=json', '{}', true, 180, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'New farmer enrolment — identity, contact, household composition, certification status, and farm-mapping GPS waypoints.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('e0aabfae-f9d2-42b0-88fa-212756227e64', 'vsla_form', 'VSLA Group', 'https://kf.kobotoolbox.org/api/v2/assets/aQozkwzBDbQXsWB4erJdbz/data/?format=json', '{}', true, 180, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Village Savings and Loans Association records — group composition, contribution cycle, and outstanding loans.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('8e8f8ec6-4f4d-4669-acba-a5fa30395889', 'clmrs_module_b_household', 'CLMRS B – Household', 'https://kf.kobotoolbox.org/api/v2/assets/aGo72EbetCFB6mfMUo3Cge/data/?format=json', '{}', true, 180, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Module B — household composition and child labour indicators (age, schooling, hazardous work exposure).') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('9d892cee-fa7c-432f-b61e-8805234eec21', 'clmrs_module_c_farm_visit', 'CLMRS C – Farm Visit', 'https://kf.kobotoolbox.org/api/v2/assets/aL2KzkALPQptaNLxNapVPi/data/?format=json', '{}', true, 180, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Module C — in-person observation during the farm visit, including any child labour incidents seen on the day.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('dfad8130-be3f-4aac-8f62-db24a42702a9', 'clmrs_module_d_child_followup', 'CLMRS D – Child Follow-up', 'https://kf.kobotoolbox.org/api/v2/assets/aZ64S3FuhCrRLR79rXuDXv/data/?format=json', '{}', true, 180, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Module D — case follow-up for children flagged at risk, including remediation steps taken and verification visits.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('27f5e19b-8e58-4a38-ad34-bc341438509a', 'clmrs_module_a_community', 'CLMRS A – Community', 'https://kf.kobotoolbox.org/api/v2/assets/atSZb76QUZHYhtkThxHgii/data/?format=json', '{}', true, 1440, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Module A — community-level child labour risk profile and protective services available.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('d3393754-2604-4f22-85cc-74ef426577fa', 'shade_trees', 'Shade Trees', 'https://kf.kobotoolbox.org/api/v2/assets/a4J8U78iDFN6PsuDfKx8aX/data/?format=json', '{}', true, 180, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Per-farm shade tree census — species, matured / young tree counts and seedling nursery inventory, used for agroforestry cover reporting.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('4d33cd41-6750-4e02-8760-5f3980a512ab', 'clmrs_module_e_awareness', 'CLMRS E – Awareness Sessions', 'https://kf.kobotoolbox.org/api/v2/assets/aFqTD47xjVQG38Qt6mJcxj/data/?format=json', '{}', true, 1440, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Module E — group awareness sessions delivered to farmers, cooperatives and communities on child-labour prevention (Annex S5).') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('f39f5c10-1c96-4d46-a222-472aaea0347a', 'farmer_coaching', 'Farmer Coaching', 'https://kf.kobotoolbox.org/api/v2/assets/aBGheqg3hFiZkAnPs8GqT9/data/?format=json', '{"gap": {"weeded": "sec_i/gap_weeded", "pruning": "sec_i/gap_pruning", "fertilizer": "sec_i/gap_fertilizer", "shadeTrees": "sec_i/gap_shade_trees", "pestsDisease": "sec_i/gap_pests_disease", "weedPressure": "sec_i/gap_weed_pressure"}, "gsp": {"ppe": "sec_l/gsp_ppe", "water": "sec_l/gsp_water", "fairPay": "sec_l/gsp_fair_pay", "firstAid": "sec_l/gsp_first_aid", "forcedLabour": "sec_l/gsp_forced_labour"}, "ipm": {"ppe": "sec_j/ipm_ppe", "records": "sec_j/ipm_records", "storage": "sec_j/ipm_storage", "approved": "sec_j/ipm_approved", "usesAgrochem": "sec_j/ipm_uses_agrochem"}, "_meta": {"koboId": "_id", "koboUuid": "_uuid", "formVersion": "__version__", "submittedAt": "_submission_time", "submittedBy": "_submitted_by"}, "clmrs": {"riskLevel": "sec_h_observation/cl_obs_risk_level || sec_h/sec_h_observation/cl_obs_risk_level", "numChildrenInHh": "sec_h_household/cl_num_children || sec_h/sec_h_household/cl_num_children", "childObservedWorking": "sec_h_observation/cl_obs_child_working || sec_h/sec_h_observation/cl_obs_child_working"}, "visit": {"society": "society || sec_a/society", "district": "district  || sec_a/district", "coachName": "coach_name", "visitDate": "visit_date"}, "farmer": {"gps": "sec_a/gps_plot", "farmName": "sec_a/farm_name || farm_name", "numPlots": "sec_a/num_plots", "avgTreeAge": "sec_a/avg_tree_age", "farmSizeHa": "sec_a/farm_size_ha", "farmerCode": "sec_a/farmer_code || farmer_code"}, "followup": {"date": "sec_p/obs_followup_date", "required": "sec_p/obs_followup_required", "adviceGiven": "sec_p/obs_advice_given", "farmCondition": "sec_p/obs_farm_condition", "nonCompliance": "sec_p/obs_non_compliance"}, "gep_eudr": {"waste": "sec_k/gep_waste", "nearWater": "sec_k/gep_near_water", "bufferZone": "sec_k/gep_buffer_zone", "deforestation": "sec_k/gep_deforestation", "treesConserved": "sec_k/gep_trees_conserved"}, "activities_repeat": {"otherActs": "sec_g[] — other_activity_type, other_activity_date, other_materials, other_person", "harvestActs": "sec_f[] — harvest_period, harvest_freq, harvest_tools, harvest_maturity, harvest_person", "pruningActs": "sec_e[] — prune_date, prune_type, prune_tools, prune_quality, prune_person", "weedingActs": "sec_d[] — weed_date, weed_method, weed_pressure, weed_chemical, weed_person", "chemicalApps": "sec_b[] — chem_app_date, chem_type, chem_product, chem_active_ingredient, chem_quantity, chem_unit, chem_target, chem_area_ha, chem_person, chem_sprayer_name, chem_sprayer_trained, chem_ppe, chem_equipment, chem_correct_dosage, chem_buffer_zones, chem_container, chem_reentry", "fertilizerApps": "sec_c[] — fert_app_date, fert_type, fert_product, fert_nutrient, fert_quantity, fert_unit, fert_area_ha, fert_method, fert_person"}, "summary_section_q": {"gaps": "sec_q/sum_gaps", "coachSignoff": "sec_q/sum_coach_signoff", "farmerSignoff": "sec_q/sum_farmer_signoff", "goodPractices": "sec_q/sum_good_practices", "coachingAdvice": "sec_q/sum_coaching_advice"}}', true, 180, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Per-farmer coaching visits — GAP/IPM/GEP/GSP compliance scores, CLMRS verdict, follow-up commitments, and section activity logs.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('6035f4cc-58dd-439c-af80-7a7bee0e64d8', 'farmer_training_attendance', 'Farmer Training', 'https://kf.kobotoolbox.org/api/v2/assets/a6WvbxuoitvMZjJYC2pJh6/data/?format=json', '{"_meta": {"koboId": "_id", "koboUuid": "_uuid", "formVersion": "__version__", "submittedAt": "_submission_time", "submittedBy": "_submitted_by"}, "session": {"venue": "program_details/venue", "endTime": "program_details/end_time", "program": "program_details/program", "society": "program_details/society", "district": "program_details/district", "startTime": "program_details/start_time", "trainingDate": "program_details/training_date", "trainingType": "program_details/training_type", "trainingTopics": "program_details/training_topics", "participantCategory": "program_details/participant_category"}, "trainer": {"name": "trainer_details/trainer_name", "phone": "trainer_details/trainer_phone"}, "trainer_eval": {"remarks": "trainer_eval/trainer_remarks", "signature": "trainer_eval/trainer_signature", "objectivesMet": "trainer_eval/session_objectives_met", "participantEngagement": "trainer_eval/participant_engagement"}, "attendance_totals": {"numMale": "attendance_totals/num_male", "numFemale": "attendance_totals/num_female", "totalParticipants": "attendance_totals/total_participants"}, "participants_repeat": {"farmer": "participants_farmers[] — farmer_code, farmername, gender, cooperative, participant_phone, consent, participant_signature"}}', true, 180, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Training session attendance — topic, program, trainer, and the attendee roster for each event.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('4860e8d8-4064-49f6-b982-2a217e520b2d', 'cocoa_purchases_society', 'Cocoa Purchases', 'https://kf.kobotoolbox.org/api/v2/assets/aKHGVTwRAbHHPhMWGTcVjZ/data/?format=json', '{"_meta": {"koboId": "_id", "koboUuid": "_uuid", "formVersion": "__version__", "submittedAt": "_submission_time", "submittedBy": "_submitted_by"}, "pc_info": {"pc_name": "pc_info/pc_name            — derivable from staff_master", "society": "pc_info/society            — derivable from station_mark_master", "district": "pc_info/district           — derivable from station_mark_master", "stationMarkNumber": "pc_info/station_mark_number — FK → station_mark_master"}, "farmer_info": {"fieldId": "farmer_info/field_id            — FK → plot_master", "weightKg": "farmer_info/weight_kg", "farmerCode": "farmer_info/farmer_code         — FK → farmer_master", "farmerName": "farmer_info/farmer_name         — derivable from farmer_master", "purchaseId": "farmer_info/purchase_id         — display PK <PLOT>-YYMMDD", "paymentType": "farmer_info/payment_type        — cash | mobile_money | cheque", "purchaseDate": "farmer_info/purchase_date", "paymentReference": "farmer_info/mobile_money_account || farmer_info/cheque_number", "amountReceivedGhs": "farmer_info/amount_received     — GHS", "cocobodCardNumber": "farmer_info/cocobod_card_number — optional COCOBOD external ID"}}', true, 360, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Society-level cocoa bean purchases — weight, payment method, station mark, premium received, and parcel link.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('170291d2-5f75-4d8a-aa8d-eb6e0c1af22a', 'primary_evacuation_depot', 'Primary Evacuation', 'https://kf.kobotoolbox.org/api/v2/assets/acwFThPi7DoW944cW4fR7D/data/?format=json', '{"_meta": {"koboId": "_id", "koboUuid": "_uuid", "formVersion": "__version__", "submittedAt": "_submission_time", "submittedBy": "_submitted_by"}, "media": {"lotPhoto": "lot_photo — image attachment via _attachments[].download_url"}, "driver_info": {"driverLastName": "driver_info/driver_last_name", "driverFirstName": "driver_info/driver_first_names", "truckRegistration": "driver_info/truck_reg_no"}, "receipt_info": {"kgReceived": "receipt_info/quantity_kg", "bagsReceived": "receipt_info/num_bags"}, "evacuation_info": {"pcName": "evacuation_info/pc_name                 — derivable from staff_master", "society": "evacuation_info/society                 — derivable from station_mark_master", "districtDepot": "evacuation_info/district                — derivable from station_mark_master", "evacuationDate": "evacuation_info/evacuation_date", "primaryWaybill": "evacuation_info/waybill_number          — display PK", "districtWarehouse": "evacuation_info/district_warehouse      — destination", "stationMarkNumber": "evacuation_info/stationmarknumber       — FK → station_mark_master"}, "lot_composition": {"purchaseEntries": "purchase_id_entries[] — purchase_id_entries/purchase_id"}}', true, 360, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Depot waybills receiving cocoa from buying stations — lot weights, driver/truck, and route segments.') ON CONFLICT (id) DO NOTHING;
INSERT INTO integration.sync_settings (id, job_key, label, source_url, field_mapping, auto_sync_enabled, interval_minutes, last_run_at, last_run_status, last_run_summary, created_at, updated_at, snapshot_hash, snapshot_uploaded_at, last_query_at, description) VALUES ('82b2fbe0-18c6-4124-b2d6-716a0014be34', 'secondary_evacuation_port', 'Secondary Evacuation', 'https://kf.kobotoolbox.org/api/v2/assets/a4yzMzwWXfLxxZP3CsuEuY/data/?format=json', '{"_meta": {"koboId": "_id", "koboUuid": "_uuid", "formVersion": "__version__", "submittedAt": "_submission_time", "submittedBy": "_submitted_by"}, "media": {"qccCertificate": "imageqcc — image attachment via _attachments[].download_url (NOT STORED bytes; URL only)"}, "form_header": {"depotGps": "form_header/gps_location         — raw Kobo lat/lon altitude precision quad", "district": "form_header/district", "depotOrigin": "form_header/depotorigin", "evacuationDate": "form_header/date", "depotOfficerName": "form_header/depot_officer_name   — derivable from staff_master (NOT STORED)"}, "lot_details": {"beanGrade": "lot_details/beangrade            — grade_1 | grade_2 | grade_3", "sealNumber": "lot_details/seal_number          — container/truck seal", "beanCategory": "lot_details/bags                 — main_crop | light_crop | small_beans | type_4 | remnant", "sourcingPartner": "lot_details/partner              — whittakers | other", "secondaryWaybill": "lot_details/waybill              — display PK"}, "transport_info": {"bagsLoaded": "transport_info/bagnumber", "driverLicence": "transport_info/drivingnumber     — Kobo field is misspelled drivingnumber", "driverLastName": "transport_info/lnamedriver", "driverFirstName": "transport_info/fnamedriver", "portDestination": "transport_info/portdest          — takoradi | tema | other", "truckRegistration": "transport_info/trackreg"}, "lot_composition": {"primaryWaybillEntries": "waybill_entries[] — waybill_entries/primary_waybill_number"}}', true, 360, NULL, NULL, NULL, '2026-07-24 10:18:54.299118+00', '2026-07-24 10:18:54.299118+00', NULL, NULL, NULL, 'Port waybills moving cocoa from depot to sourcing partner — composition of primary waybills + DDS metadata per lot.') ON CONFLICT (id) DO NOTHING;
