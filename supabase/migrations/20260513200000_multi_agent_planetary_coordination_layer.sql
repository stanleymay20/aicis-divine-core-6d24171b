-- Multi-Agent Planetary Coordination Layer
-- Adds distributed operational agents, delegation workflows,
-- coordination meshes, consensus arbitration, and shared cognition.

-- =====================================================
-- 1. Agent registry
-- =====================================================
CREATE TABLE IF NOT EXISTS public.planetary_operational_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_key text UNIQUE NOT NULL,
  agent_name text NOT NULL,
  agent_domain text NOT NULL,
  agent_role text DEFAULT 'specialist',
  operational_scope text DEFAULT 'global',
  coordination_priority numeric DEFAULT 50,
  confidence_weight numeric DEFAULT 50,
  escalation_threshold numeric DEFAULT 75,
  autonomy_level text DEFAULT 'supervised',
  governance_profile text DEFAULT 'standard',
  active boolean DEFAULT true,
  capabilities jsonb DEFAULT '[]'::jsonb,
  coordination_channels jsonb DEFAULT '[]'::jsonb,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_operational_agents_domain
ON public.planetary_operational_agents(agent_domain, active);

-- =====================================================
-- 2. Agent task orchestration
-- =====================================================
CREATE TABLE IF NOT EXISTS public.agent_coordination_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_key text UNIQUE NOT NULL,
  task_type text NOT NULL,
  source_event text,
  source_domain text,
  assigned_agent_key text REFERENCES public.planetary_operational_agents(agent_key) ON DELETE SET NULL,
  delegated_by_agent text,
  coordination_status text DEFAULT 'queued',
  operational_priority text DEFAULT 'medium',
  confidence_requirement numeric DEFAULT 65,
  escalation_required boolean DEFAULT false,
  governance_review_required boolean DEFAULT false,
  task_payload jsonb DEFAULT '{}'::jsonb,
  result_payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_agent_tasks_status_priority
ON public.agent_coordination_tasks(coordination_status, operational_priority, created_at DESC);

-- =====================================================
-- 3. Agent coordination mesh
-- =====================================================
CREATE TABLE IF NOT EXISTS public.agent_coordination_mesh (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mesh_key text UNIQUE NOT NULL,
  source_agent_key text REFERENCES public.planetary_operational_agents(agent_key) ON DELETE CASCADE,
  target_agent_key text REFERENCES public.planetary_operational_agents(agent_key) ON DELETE CASCADE,
  coordination_type text DEFAULT 'information_exchange',
  trust_weight numeric DEFAULT 50,
  coordination_frequency text DEFAULT 'continuous',
  active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- =====================================================
-- 4. Shared cognition memory
-- =====================================================
CREATE TABLE IF NOT EXISTS public.agent_shared_cognition_memory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cognition_key text UNIQUE NOT NULL,
  originating_agent text,
  cognition_type text,
  source_domain text,
  cognition_summary text,
  confidence_score numeric DEFAULT 0,
  supporting_evidence jsonb DEFAULT '[]'::jsonb,
  recommended_actions jsonb DEFAULT '[]'::jsonb,
  propagation_targets jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- =====================================================
-- 5. Consensus arbitration
-- =====================================================
CREATE TABLE IF NOT EXISTS public.agent_consensus_arbitration (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arbitration_key text UNIQUE NOT NULL,
  arbitration_topic text,
  participating_agents jsonb DEFAULT '[]'::jsonb,
  consensus_status text DEFAULT 'pending',
  consensus_confidence numeric DEFAULT 0,
  conflicting_positions jsonb DEFAULT '[]'::jsonb,
  final_resolution text,
  escalation_required boolean DEFAULT false,
  human_review_required boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  resolved_at timestamptz
);

-- =====================================================
-- 6. Seed agents
-- =====================================================
INSERT INTO public.planetary_operational_agents(
  agent_key,agent_name,agent_domain,agent_role,coordination_priority,
  confidence_weight,escalation_threshold,autonomy_level,governance_profile,
  capabilities,coordination_channels
)
VALUES
('climate-agent','Climate Intelligence Agent','climate','monitoring_specialist',90,85,80,'supervised','high_governance',
 jsonb_build_array('extreme weather monitoring','climate escalation analysis','resilience forecasting'),
 jsonb_build_array('humanitarian-agent','logistics-agent','executive-agent')),
('humanitarian-agent','Humanitarian Coordination Agent','humanitarian','response_specialist',92,88,75,'supervised','critical_governance',
 jsonb_build_array('humanitarian risk assessment','population vulnerability analysis','aid coordination'),
 jsonb_build_array('climate-agent','logistics-agent','governance-agent')),
('logistics-agent','Logistics Stability Agent','logistics','infrastructure_specialist',85,82,70,'supervised','standard',
 jsonb_build_array('shipping route analysis','supply chain resilience','transport disruption forecasting'),
 jsonb_build_array('humanitarian-agent','economic-agent')),
('cyber-agent','Cyber Defense Agent','cyber','security_specialist',88,86,78,'supervised','high_governance',
 jsonb_build_array('cyber anomaly detection','infrastructure attack monitoring','digital resilience scoring'),
 jsonb_build_array('governance-agent','executive-agent')),
('governance-agent','Governance Oversight Agent','governance','oversight_specialist',95,93,65,'restricted','critical_governance',
 jsonb_build_array('policy review','approval workflows','safety enforcement'),
 jsonb_build_array('executive-agent','humanitarian-agent')),
('executive-agent','Executive Coordination Agent','executive','coordination_specialist',97,90,60,'restricted','critical_governance',
 jsonb_build_array('executive briefing generation','cross-domain synthesis','strategic escalation'),
 jsonb_build_array('all-agents'))
ON CONFLICT(agent_key) DO UPDATE SET
  active = true,
  updated_at = now();

-- =====================================================
-- 7. Coordination mesh seeding
-- =====================================================
INSERT INTO public.agent_coordination_mesh(
  mesh_key,source_agent_key,target_agent_key,coordination_type,trust_weight,coordination_frequency,active
)
VALUES
(md5('climate-humanitarian'),'climate-agent','humanitarian-agent','risk_escalation',90,'continuous',true),
(md5('humanitarian-logistics'),'humanitarian-agent','logistics-agent','resource_coordination',88,'continuous',true),
(md5('logistics-executive'),'logistics-agent','executive-agent','strategic_reporting',82,'event_driven',true),
(md5('cyber-governance'),'cyber-agent','governance-agent','security_escalation',92,'continuous',true),
(md5('governance-executive'),'governance-agent','executive-agent','approval_escalation',95,'continuous',true)
ON CONFLICT(mesh_key) DO UPDATE SET active = true;

-- =====================================================
-- 8. Task delegation engine
-- =====================================================
CREATE OR REPLACE FUNCTION public.delegate_agent_coordination_task(
  p_task_type text,
  p_source_event text,
  p_source_domain text,
  p_priority text DEFAULT 'medium'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ag record;
  v_key text;
  v_count integer := 0;
BEGIN
  FOR ag IN
    SELECT *
    FROM public.planetary_operational_agents
    WHERE active = true
      AND (
        agent_domain = p_source_domain
        OR agent_role = 'coordination_specialist'
        OR agent_domain = 'governance'
      )
  LOOP
    v_key := md5(p_task_type || '|' || p_source_event || '|' || ag.agent_key);

    INSERT INTO public.agent_coordination_tasks(
      task_key,task_type,source_event,source_domain,assigned_agent_key,
      coordination_status,operational_priority,confidence_requirement,
      escalation_required,governance_review_required,task_payload,
      created_at,updated_at
    ) VALUES (
      v_key,
      p_task_type,
      p_source_event,
      p_source_domain,
      ag.agent_key,
      'queued',
      p_priority,
      ag.confidence_weight,
      CASE WHEN ag.escalation_threshold <= 70 THEN true ELSE false END,
      CASE WHEN ag.governance_profile IN ('high_governance','critical_governance') THEN true ELSE false END,
      jsonb_build_object(
        'source_event',p_source_event,
        'source_domain',p_source_domain,
        'assigned_capabilities',ag.capabilities
      ),
      now(),now()
    )
    ON CONFLICT(task_key) DO UPDATE SET
      coordination_status = 'queued',
      updated_at = now();

    v_count := v_count + 1;
  END LOOP;

  RETURN jsonb_build_object('status','success','tasks_delegated',v_count);
END;
$$;

-- =====================================================
-- 9. Shared cognition propagation
-- =====================================================
CREATE OR REPLACE FUNCTION public.propagate_agent_cognition(
  p_originating_agent text,
  p_cognition_type text,
  p_source_domain text,
  p_summary text,
  p_confidence numeric DEFAULT 70
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := md5(p_originating_agent || '|' || p_summary || '|' || now()::text);

  INSERT INTO public.agent_shared_cognition_memory(
    cognition_key,originating_agent,cognition_type,source_domain,
    cognition_summary,confidence_score,supporting_evidence,
    recommended_actions,propagation_targets,created_at
  ) VALUES (
    v_key,
    p_originating_agent,
    p_cognition_type,
    p_source_domain,
    p_summary,
    p_confidence,
    jsonb_build_array('telemetry','historical memory','causal propagation'),
    jsonb_build_array('increase monitoring','coordinate intervention review'),
    jsonb_build_array('executive-agent','governance-agent'),
    now()
  )
  ON CONFLICT(cognition_key) DO NOTHING;

  RETURN jsonb_build_object('status','success','cognition_key',v_key);
END;
$$;

-- =====================================================
-- 10. Consensus arbitration engine
-- =====================================================
CREATE OR REPLACE FUNCTION public.generate_agent_consensus(
  p_topic text,
  p_agents jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_confidence numeric := 75;
  v_key text;
  v_escalation boolean := false;
BEGIN
  IF jsonb_array_length(p_agents) >= 4 THEN
    v_confidence := 88;
  ELSIF jsonb_array_length(p_agents) >= 2 THEN
    v_confidence := 78;
  END IF;

  IF p_topic ILIKE '%geopolitical%' OR p_topic ILIKE '%humanitarian%' THEN
    v_escalation := true;
  END IF;

  v_key := md5(p_topic || '|' || now()::text);

  INSERT INTO public.agent_consensus_arbitration(
    arbitration_key,arbitration_topic,participating_agents,
    consensus_status,consensus_confidence,conflicting_positions,
    final_resolution,escalation_required,human_review_required,
    created_at
  ) VALUES (
    v_key,
    p_topic,
    p_agents,
    CASE WHEN v_confidence >= 80 THEN 'consensus_reached' ELSE 'partial_consensus' END,
    v_confidence,
    jsonb_build_array('monitor confidence divergence','evaluate conflicting propagation assumptions'),
    'Consensus generated from multi-agent operational synthesis.',
    v_escalation,
    v_escalation,
    now()
  )
  ON CONFLICT(arbitration_key) DO NOTHING;

  RETURN jsonb_build_object(
    'status','success',
    'consensus_confidence',v_confidence,
    'escalation_required',v_escalation
  );
END;
$$;

-- =====================================================
-- 11. Autonomous coordination cycle
-- =====================================================
CREATE OR REPLACE FUNCTION public.run_multi_agent_coordination_cycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sig record;
  v_tasks integer := 0;
  v_cognition integer := 0;
BEGIN
  FOR sig IN
    SELECT *
    FROM public.global_signals
    WHERE COALESCE(canonical_event_status,'canonical') = 'canonical'
      AND COALESCE(impact_score,0) >= 70
      AND COALESCE(ingested_at,created_at) >= now() - interval '24 hours'
    ORDER BY impact_score DESC
    LIMIT 25
  LOOP
    PERFORM public.delegate_agent_coordination_task(
      'risk_analysis',
      sig.title,
      COALESCE(sig.category,'general'),
      CASE WHEN COALESCE(sig.impact_score,0) >= 85 THEN 'critical' ELSE 'high' END
    );

    PERFORM public.propagate_agent_cognition(
      'executive-agent',
      'strategic_signal',
      COALESCE(sig.category,'general'),
      'High-impact signal requires cross-domain coordination and executive visibility.',
      LEAST(100,COALESCE(sig.impact_score,70))
    );

    v_tasks := v_tasks + 1;
    v_cognition := v_cognition + 1;
  END LOOP;

  PERFORM public.generate_agent_consensus(
    'Cross-domain operational stability assessment',
    '["climate-agent","humanitarian-agent","governance-agent","executive-agent"]'::jsonb
  );

  INSERT INTO public.automation_logs(job_name,status,message)
  VALUES (
    'multi-agent-coordination-cycle',
    'success',
    'tasks=' || v_tasks || ', cognition=' || v_cognition
  );

  RETURN jsonb_build_object(
    'status','success',
    'tasks_delegated',v_tasks,
    'cognition_events',v_cognition
  );
END;
$$;

-- =====================================================
-- 12. Command views
-- =====================================================
CREATE OR REPLACE VIEW public.operational_agent_command_view AS
SELECT
  agent_name,
  agent_domain,
  agent_role,
  operational_scope,
  autonomy_level,
  governance_profile,
  coordination_priority,
  confidence_weight,
  active,
  created_at
FROM public.planetary_operational_agents
ORDER BY coordination_priority DESC;

CREATE OR REPLACE VIEW public.agent_task_command_view AS
SELECT
  task_type,
  source_event,
  source_domain,
  assigned_agent_key,
  coordination_status,
  operational_priority,
  escalation_required,
  governance_review_required,
  created_at,
  completed_at
FROM public.agent_coordination_tasks
ORDER BY
  CASE operational_priority WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,
  created_at DESC;

CREATE OR REPLACE VIEW public.agent_cognition_command_view AS
SELECT
  originating_agent,
  cognition_type,
  source_domain,
  cognition_summary,
  confidence_score,
  created_at
FROM public.agent_shared_cognition_memory
ORDER BY confidence_score DESC, created_at DESC;

CREATE OR REPLACE VIEW public.agent_consensus_command_view AS
SELECT
  arbitration_topic,
  consensus_status,
  consensus_confidence,
  escalation_required,
  human_review_required,
  created_at,
  resolved_at
FROM public.agent_consensus_arbitration
ORDER BY consensus_confidence DESC, created_at DESC;

INSERT INTO public.automation_logs(job_name,status,message)
VALUES (
  'multi-agent-planetary-coordination-layer',
  'success',
  'operational agents, coordination mesh, task delegation, shared cognition, and consensus arbitration initialized'
);
