CREATE TABLE IF NOT EXISTS public.prediction_history_training_projections (
  logged_hour timestamptz PRIMARY KEY
    REFERENCES public.prediction_history (logged_hour) ON DELETE CASCADE,
  b_forecast jsonb,
  other_forecasts jsonb
);

ALTER TABLE public.prediction_history_training_projections ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.prediction_history_training_projections
FROM public, anon, authenticated;

GRANT ALL PRIVILEGES ON TABLE public.prediction_history_training_projections
TO service_role;

CREATE OR REPLACE FUNCTION public.extract_prediction_history_training_projection(
  p_debug_info jsonb
)
RETURNS TABLE (
  b_forecast jsonb,
  other_forecasts jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_forecasts jsonb;
  v_item jsonb;
  v_projected jsonb;
  v_ca jsonb;
  v_other jsonb := '{}'::jsonb;
  v_model text;
BEGIN
  IF p_debug_info IS NULL OR jsonb_typeof(p_debug_info) <> 'object' THEN
    b_forecast := NULL;
    other_forecasts := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  v_forecasts := p_debug_info -> 'experimentalProbabilityForecasts';
  IF v_forecasts IS NULL OR jsonb_typeof(v_forecasts) <> 'object' THEN
    b_forecast := NULL;
    other_forecasts := NULL;
    RETURN NEXT;
    RETURN;
  END IF;

  b_forecast := NULL;
  v_item := v_forecasts -> 'hazard-regime-random-continuous-calibrated-v1';
  IF jsonb_typeof(v_item) = 'object' THEN
    v_projected := jsonb_strip_nulls(
      jsonb_build_object(
        'modelVersion', v_item -> 'modelVersion',
        'generatedAt', v_item -> 'generatedAt',
        'rawProbability24h', v_item -> 'rawProbability24h',
        'rawProbability48h', v_item -> 'rawProbability48h',
        'probability24h', v_item -> 'probability24h',
        'probability48h', v_item -> 'probability48h'
      )
    );
    IF v_projected <> '{}'::jsonb THEN
      b_forecast := v_projected;
    END IF;
  END IF;

  FOREACH v_model IN ARRAY ARRAY[
    'hazard-odds-v4-logit-calibrated-prequential-v3',
    'hazard-regime-elapsed-v1',
    'hazard-regime-random-elapsed-v1',
    'hazard-odds-v3-recency-bayes-h30-r3'
  ] LOOP
    v_item := v_forecasts -> v_model;
    IF jsonb_typeof(v_item) = 'object' THEN
      v_projected := jsonb_strip_nulls(
        jsonb_build_object(
          'modelVersion', v_item -> 'modelVersion',
          'generatedAt', v_item -> 'generatedAt',
          'probability24h', v_item -> 'probability24h',
          'probability48h', v_item -> 'probability48h'
        )
      );
      IF v_projected <> '{}'::jsonb THEN
        v_other := v_other || jsonb_build_object(v_model, v_projected);
      END IF;
    END IF;
  END LOOP;

  FOREACH v_model IN ARRAY ARRAY[
    'hazard-contextual-burst-circadian-v1',
    'hazard-contextual-burst-circadian-normalized-v2'
  ] LOOP
    v_item := v_forecasts -> v_model;
    IF jsonb_typeof(v_item) = 'object' THEN
      v_projected := jsonb_strip_nulls(
        jsonb_build_object(
          'modelVersion', v_item -> 'modelVersion',
          'generatedAt', v_item -> 'generatedAt',
          'rawProbability24h', v_item -> 'rawProbability24h',
          'rawProbability48h', v_item -> 'rawProbability48h'
        )
      );
      IF v_projected <> '{}'::jsonb THEN
        v_other := v_other || jsonb_build_object(v_model, v_projected);
      END IF;
    END IF;
  END LOOP;

  v_model := 'hazard-regime-random-continuous-context-calibrated-bw18-tr54-v1';
  v_item := v_forecasts -> v_model;
  IF jsonb_typeof(v_item) = 'object' THEN
    v_ca := NULL;
    IF jsonb_typeof(v_item -> 'contextAware') = 'object' THEN
      v_ca := jsonb_strip_nulls(
        jsonb_build_object(
          'contextSnapshotVersion', v_item -> 'contextAware' -> 'contextSnapshotVersion',
          'baselineProbability24h', v_item -> 'contextAware' -> 'baselineProbability24h',
          'baselineProbability48h', v_item -> 'contextAware' -> 'baselineProbability48h',
          'contextState', v_item -> 'contextAware' -> 'contextState',
          'contextStateProvenance', v_item -> 'contextAware' -> 'contextStateProvenance',
          'trainingEligible', v_item -> 'contextAware' -> 'trainingEligible',
          'contextExclusionReason', v_item -> 'contextAware' -> 'contextExclusionReason'
        )
      );
      IF v_ca = '{}'::jsonb THEN
        v_ca := NULL;
      END IF;
    END IF;
    v_projected := jsonb_strip_nulls(
      jsonb_build_object(
        'modelVersion', v_item -> 'modelVersion',
        'generatedAt', v_item -> 'generatedAt',
        'contextAware', v_ca
      )
    );
    IF v_projected <> '{}'::jsonb THEN
      v_other := v_other || jsonb_build_object(v_model, v_projected);
    END IF;
  END IF;

  v_model := 'hazard-regime-random-continuous-post-reset-age-raw-bw18-tr54-v1';
  v_item := v_forecasts -> v_model;
  IF jsonb_typeof(v_item) = 'object' THEN
    v_projected := jsonb_strip_nulls(
      jsonb_build_object(
        'modelVersion', v_item -> 'modelVersion',
        'generatedAt', v_item -> 'generatedAt',
        'baseline24h', v_item -> 'baseline24h',
        'baseline48h', v_item -> 'baseline48h'
      )
    );
    IF v_projected <> '{}'::jsonb THEN
      v_other := v_other || jsonb_build_object(v_model, v_projected);
    END IF;
  END IF;

  IF v_other = '{}'::jsonb THEN
    other_forecasts := NULL;
  ELSE
    other_forecasts := v_other;
  END IF;

  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_prediction_history_training_projection()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_b jsonb;
  v_other jsonb;
BEGIN
  SELECT proj.b_forecast, proj.other_forecasts
  INTO v_b, v_other
  FROM public.extract_prediction_history_training_projection(NEW.debug_info) AS proj;

  INSERT INTO public.prediction_history_training_projections (
    logged_hour,
    b_forecast,
    other_forecasts
  )
  VALUES (
    NEW.logged_hour,
    v_b,
    v_other
  )
  ON CONFLICT (logged_hour) DO UPDATE
  SET
    b_forecast = EXCLUDED.b_forecast,
    other_forecasts = EXCLUDED.other_forecasts;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.extract_prediction_history_training_projection(jsonb)
FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.extract_prediction_history_training_projection(jsonb)
TO service_role;

REVOKE ALL ON FUNCTION public.sync_prediction_history_training_projection()
FROM public, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.sync_prediction_history_training_projection()
TO service_role;

DROP TRIGGER IF EXISTS prediction_history_sync_training_projection_trigger
ON public.prediction_history;

CREATE TRIGGER prediction_history_sync_training_projection_trigger
AFTER INSERT OR UPDATE OF debug_info ON public.prediction_history
FOR EACH ROW
EXECUTE FUNCTION public.sync_prediction_history_training_projection();

INSERT INTO public.prediction_history_training_projections (
  logged_hour,
  b_forecast,
  other_forecasts
)
SELECT
  ph.logged_hour,
  proj.b_forecast,
  proj.other_forecasts
FROM public.prediction_history AS ph
CROSS JOIN LATERAL public.extract_prediction_history_training_projection(ph.debug_info) AS proj
ON CONFLICT (logged_hour) DO UPDATE
SET
  b_forecast = EXCLUDED.b_forecast,
  other_forecasts = EXCLUDED.other_forecasts;
