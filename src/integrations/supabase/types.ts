export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      accountability_nodes: {
        Row: {
          api_endpoint: string | null
          api_key: string | null
          api_key_hash: string | null
          contact_email: string | null
          country: string
          created_at: string | null
          id: string
          joined_at: string | null
          jurisdiction: string
          last_active_at: string | null
          metadata: Json | null
          org_name: string
          org_type: Database["public"]["Enums"]["org_type"]
          pgp_public_key: string | null
          rate_limit_per_hour: number | null
          updated_at: string | null
          verified: boolean | null
        }
        Insert: {
          api_endpoint?: string | null
          api_key?: string | null
          api_key_hash?: string | null
          contact_email?: string | null
          country: string
          created_at?: string | null
          id?: string
          joined_at?: string | null
          jurisdiction: string
          last_active_at?: string | null
          metadata?: Json | null
          org_name: string
          org_type: Database["public"]["Enums"]["org_type"]
          pgp_public_key?: string | null
          rate_limit_per_hour?: number | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Update: {
          api_endpoint?: string | null
          api_key?: string | null
          api_key_hash?: string | null
          contact_email?: string | null
          country?: string
          created_at?: string | null
          id?: string
          joined_at?: string | null
          jurisdiction?: string
          last_active_at?: string | null
          metadata?: Json | null
          org_name?: string
          org_type?: Database["public"]["Enums"]["org_type"]
          pgp_public_key?: string | null
          rate_limit_per_hour?: number | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Relationships: []
      }
      adi_decisions: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          confidence: number | null
          country_iso3: string | null
          created_at: string | null
          domain: string
          executed_at: string | null
          id: string
          options: Json
          outcome_assessment: string | null
          outcome_score: number | null
          reasoning_md: string | null
          recommended_option_rank: number | null
          region: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          severity_score: number
          signal_id: string | null
          signal_source: string
          signal_summary: string
          status: string
          updated_at: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          confidence?: number | null
          country_iso3?: string | null
          created_at?: string | null
          domain: string
          executed_at?: string | null
          id?: string
          options?: Json
          outcome_assessment?: string | null
          outcome_score?: number | null
          reasoning_md?: string | null
          recommended_option_rank?: number | null
          region?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity_score?: number
          signal_id?: string | null
          signal_source: string
          signal_summary: string
          status?: string
          updated_at?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          confidence?: number | null
          country_iso3?: string | null
          created_at?: string | null
          domain?: string
          executed_at?: string | null
          id?: string
          options?: Json
          outcome_assessment?: string | null
          outcome_score?: number | null
          reasoning_md?: string | null
          recommended_option_rank?: number | null
          region?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          severity_score?: number
          signal_id?: string | null
          signal_source?: string
          signal_summary?: string
          status?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      adi_scenarios: {
        Row: {
          confidence: number | null
          created_at: string | null
          created_by: string | null
          decision_id: string | null
          id: string
          input_params: Json
          probability_tree: Json | null
          projection_30d: Json | null
          projection_60d: Json | null
          projection_90d: Json | null
          reasoning_md: string | null
          scenario_name: string
          scenario_type: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          created_by?: string | null
          decision_id?: string | null
          id?: string
          input_params?: Json
          probability_tree?: Json | null
          projection_30d?: Json | null
          projection_60d?: Json | null
          projection_90d?: Json | null
          reasoning_md?: string | null
          scenario_name: string
          scenario_type?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          created_by?: string | null
          decision_id?: string | null
          id?: string
          input_params?: Json
          probability_tree?: Json | null
          projection_30d?: Json | null
          projection_60d?: Json | null
          projection_90d?: Json | null
          reasoning_md?: string | null
          scenario_name?: string
          scenario_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "adi_scenarios_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "adi_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      admin_regions: {
        Row: {
          admin_level: number
          area_km2: number | null
          bbox: Json | null
          country_iso3: string
          created_at: string | null
          id: string
          iso_code: string | null
          lat: number | null
          lon: number | null
          metadata: Json | null
          name: string
          osm_id: number | null
          parent_id: string | null
          population_est: number | null
          source: string | null
          updated_at: string | null
          urban_rural: string | null
        }
        Insert: {
          admin_level: number
          area_km2?: number | null
          bbox?: Json | null
          country_iso3: string
          created_at?: string | null
          id?: string
          iso_code?: string | null
          lat?: number | null
          lon?: number | null
          metadata?: Json | null
          name: string
          osm_id?: number | null
          parent_id?: string | null
          population_est?: number | null
          source?: string | null
          updated_at?: string | null
          urban_rural?: string | null
        }
        Update: {
          admin_level?: number
          area_km2?: number | null
          bbox?: Json | null
          country_iso3?: string
          created_at?: string | null
          id?: string
          iso_code?: string | null
          lat?: number | null
          lon?: number | null
          metadata?: Json | null
          name?: string
          osm_id?: number | null
          parent_id?: string | null
          population_est?: number | null
          source?: string | null
          updated_at?: string | null
          urban_rural?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "admin_regions_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "admin_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_messages: {
        Row: {
          content: string
          created_at: string | null
          id: string
          role: string | null
          session_id: string | null
          tokens_est: number | null
          user_id: string | null
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          role?: string | null
          session_id?: string | null
          tokens_est?: number | null
          user_id?: string | null
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          role?: string | null
          session_id?: string | null
          tokens_est?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_chat_messages_session_id_fkey"
            columns: ["session_id"]
            isOneToOne: false
            referencedRelation: "ai_chat_sessions"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_chat_sessions: {
        Row: {
          id: string
          last_active_at: string | null
          started_at: string | null
          title: string | null
          user_id: string | null
        }
        Insert: {
          id?: string
          last_active_at?: string | null
          started_at?: string | null
          title?: string | null
          user_id?: string | null
        }
        Update: {
          id?: string
          last_active_at?: string | null
          started_at?: string | null
          title?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      ai_decision_logs: {
        Row: {
          bias_score: number | null
          confidence: number | null
          created_at: string | null
          created_by: string | null
          division_key: string
          ethical_flags: string[] | null
          explanation: Json | null
          id: string
          input_summary: string
          model_name: string
          output_summary: string
          reviewer_id: string | null
        }
        Insert: {
          bias_score?: number | null
          confidence?: number | null
          created_at?: string | null
          created_by?: string | null
          division_key: string
          ethical_flags?: string[] | null
          explanation?: Json | null
          id?: string
          input_summary: string
          model_name: string
          output_summary: string
          reviewer_id?: string | null
        }
        Update: {
          bias_score?: number | null
          confidence?: number | null
          created_at?: string | null
          created_by?: string | null
          division_key?: string
          ethical_flags?: string[] | null
          explanation?: Json | null
          id?: string
          input_summary?: string
          model_name?: string
          output_summary?: string
          reviewer_id?: string | null
        }
        Relationships: []
      }
      ai_divisions: {
        Row: {
          created_at: string
          division_key: string
          id: string
          last_check: string
          name: string
          performance_score: number
          status: Database["public"]["Enums"]["division_status"]
          updated_at: string
          uptime_percentage: number
        }
        Insert: {
          created_at?: string
          division_key: string
          id?: string
          last_check?: string
          name: string
          performance_score?: number
          status?: Database["public"]["Enums"]["division_status"]
          updated_at?: string
          uptime_percentage?: number
        }
        Update: {
          created_at?: string
          division_key?: string
          id?: string
          last_check?: string
          name?: string
          performance_score?: number
          status?: Database["public"]["Enums"]["division_status"]
          updated_at?: string
          uptime_percentage?: number
        }
        Relationships: []
      }
      ai_learning_log: {
        Row: {
          created_at: string | null
          id: string
          insight: string | null
          record_id: string | null
          source_table: string | null
          success: boolean | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          insight?: string | null
          record_id?: string | null
          source_table?: string | null
          success?: boolean | null
        }
        Update: {
          created_at?: string | null
          id?: string
          insight?: string | null
          record_id?: string | null
          source_table?: string | null
          success?: boolean | null
        }
        Relationships: []
      }
      ai_mitigation_actions: {
        Row: {
          action_type: string
          created_at: string | null
          crisis_id: string | null
          executed_at: string | null
          id: string
          parameters: Json | null
          status: string | null
        }
        Insert: {
          action_type: string
          created_at?: string | null
          crisis_id?: string | null
          executed_at?: string | null
          id?: string
          parameters?: Json | null
          status?: string | null
        }
        Update: {
          action_type?: string
          created_at?: string | null
          crisis_id?: string | null
          executed_at?: string | null
          id?: string
          parameters?: Json | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_mitigation_actions_crisis_id_fkey"
            columns: ["crisis_id"]
            isOneToOne: false
            referencedRelation: "crisis_events"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_reports: {
        Row: {
          content: string
          created_at: string
          division: string
          id: string
          title: string
        }
        Insert: {
          content: string
          created_at?: string
          division: string
          id?: string
          title: string
        }
        Update: {
          content?: string
          created_at?: string
          division?: string
          id?: string
          title?: string
        }
        Relationships: []
      }
      aicis_early_warnings: {
        Row: {
          admin_level_1: string | null
          confidence: number
          dedup_key: string
          escalation_probability: number
          event_count: number
          event_type: string
          first_detected_at: string
          id: string
          iso3: string | null
          last_updated_at: string
          locality: string | null
          metric: Json | null
          recommended_next_action: string | null
          resolved_at: string | null
          severity: number
          source_count: number
          status: string
          subtype: string | null
          time_window_hours: number
          warning_kind: string
        }
        Insert: {
          admin_level_1?: string | null
          confidence?: number
          dedup_key: string
          escalation_probability?: number
          event_count?: number
          event_type: string
          first_detected_at?: string
          id?: string
          iso3?: string | null
          last_updated_at?: string
          locality?: string | null
          metric?: Json | null
          recommended_next_action?: string | null
          resolved_at?: string | null
          severity?: number
          source_count?: number
          status?: string
          subtype?: string | null
          time_window_hours?: number
          warning_kind: string
        }
        Update: {
          admin_level_1?: string | null
          confidence?: number
          dedup_key?: string
          escalation_probability?: number
          event_count?: number
          event_type?: string
          first_detected_at?: string
          id?: string
          iso3?: string | null
          last_updated_at?: string
          locality?: string | null
          metric?: Json | null
          recommended_next_action?: string | null
          resolved_at?: string | null
          severity?: number
          source_count?: number
          status?: string
          subtype?: string | null
          time_window_hours?: number
          warning_kind?: string
        }
        Relationships: []
      }
      aicis_export_logs: {
        Row: {
          created_at: string
          dataset_name: string
          duration_ms: number | null
          error_message: string | null
          exported_by: string | null
          exported_by_email: string | null
          file_size_bytes: number | null
          filters: Json
          format: string
          id: string
          row_count: number
          sha256_checksum: string | null
          status: string
          storage_path: string | null
        }
        Insert: {
          created_at?: string
          dataset_name: string
          duration_ms?: number | null
          error_message?: string | null
          exported_by?: string | null
          exported_by_email?: string | null
          file_size_bytes?: number | null
          filters?: Json
          format: string
          id?: string
          row_count?: number
          sha256_checksum?: string | null
          status?: string
          storage_path?: string | null
        }
        Update: {
          created_at?: string
          dataset_name?: string
          duration_ms?: number | null
          error_message?: string | null
          exported_by?: string | null
          exported_by_email?: string | null
          file_size_bytes?: number | null
          filters?: Json
          format?: string
          id?: string
          row_count?: number
          sha256_checksum?: string | null
          status?: string
          storage_path?: string | null
        }
        Relationships: []
      }
      aicis_geo_aliases: {
        Row: {
          alias: string
          created_at: string | null
          geo_entity_id: string | null
          id: string
          language: string | null
        }
        Insert: {
          alias: string
          created_at?: string | null
          geo_entity_id?: string | null
          id?: string
          language?: string | null
        }
        Update: {
          alias?: string
          created_at?: string | null
          geo_entity_id?: string | null
          id?: string
          language?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aicis_geo_aliases_geo_entity_id_fkey"
            columns: ["geo_entity_id"]
            isOneToOne: false
            referencedRelation: "aicis_geo_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      aicis_geo_entities: {
        Row: {
          admin_level_1: string | null
          admin_level_2: string | null
          aliases: Json | null
          city: string | null
          created_at: string
          geo_confidence: number | null
          id: string
          iso3: string
          lat: number | null
          locality: string | null
          lon: number | null
          population: number | null
          source: string | null
          source_id: string | null
        }
        Insert: {
          admin_level_1?: string | null
          admin_level_2?: string | null
          aliases?: Json | null
          city?: string | null
          created_at?: string
          geo_confidence?: number | null
          id?: string
          iso3: string
          lat?: number | null
          locality?: string | null
          lon?: number | null
          population?: number | null
          source?: string | null
          source_id?: string | null
        }
        Update: {
          admin_level_1?: string | null
          admin_level_2?: string | null
          aliases?: Json | null
          city?: string | null
          created_at?: string
          geo_confidence?: number | null
          id?: string
          iso3?: string
          lat?: number | null
          locality?: string | null
          lon?: number | null
          population?: number | null
          source?: string | null
          source_id?: string | null
        }
        Relationships: []
      }
      aicis_geo_resolution_audit: {
        Row: {
          attempted_match: string | null
          country_hint: string | null
          created_at: string
          extracted_place: string
          id: string
          language: string | null
          match_score: number | null
          reason_unresolved: string | null
          signal_id: string | null
          source_name: string | null
        }
        Insert: {
          attempted_match?: string | null
          country_hint?: string | null
          created_at?: string
          extracted_place: string
          id?: string
          language?: string | null
          match_score?: number | null
          reason_unresolved?: string | null
          signal_id?: string | null
          source_name?: string | null
        }
        Update: {
          attempted_match?: string | null
          country_hint?: string | null
          created_at?: string
          extracted_place?: string
          id?: string
          language?: string | null
          match_score?: number | null
          reason_unresolved?: string | null
          signal_id?: string | null
          source_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "aicis_geo_resolution_audit_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "aicis_raw_local_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      aicis_geo_stoplist: {
        Row: {
          added_at: string
          category: string
          phrase: string
        }
        Insert: {
          added_at?: string
          category?: string
          phrase: string
        }
        Update: {
          added_at?: string
          category?: string
          phrase?: string
        }
        Relationships: []
      }
      aicis_keyword_packs: {
        Row: {
          country: string | null
          created_at: string
          domain: string
          id: string
          keywords: Json
          language: string
          subtype: string | null
          weight: number | null
        }
        Insert: {
          country?: string | null
          created_at?: string
          domain: string
          id?: string
          keywords: Json
          language?: string
          subtype?: string | null
          weight?: number | null
        }
        Update: {
          country?: string | null
          created_at?: string
          domain?: string
          id?: string
          keywords?: Json
          language?: string
          subtype?: string | null
          weight?: number | null
        }
        Relationships: []
      }
      aicis_local_events: {
        Row: {
          admin_level_1: string | null
          bridged_to_normalized: boolean | null
          confidence: number | null
          confidence_tier: string | null
          created_at: string
          description: string | null
          end_time: string | null
          event_type: string
          geo_entity_id: string | null
          id: string
          iso3: string
          iso3_normalized: string | null
          lat: number | null
          locality: string | null
          lon: number | null
          matched_keywords: Json | null
          proxy_boost: number | null
          raw_signal_ids: Json
          severity: number | null
          source_count: number
          start_time: string
          status: string
          subtype: string | null
          title: string | null
          updated_at: string
        }
        Insert: {
          admin_level_1?: string | null
          bridged_to_normalized?: boolean | null
          confidence?: number | null
          confidence_tier?: string | null
          created_at?: string
          description?: string | null
          end_time?: string | null
          event_type: string
          geo_entity_id?: string | null
          id?: string
          iso3: string
          iso3_normalized?: string | null
          lat?: number | null
          locality?: string | null
          lon?: number | null
          matched_keywords?: Json | null
          proxy_boost?: number | null
          raw_signal_ids?: Json
          severity?: number | null
          source_count?: number
          start_time: string
          status?: string
          subtype?: string | null
          title?: string | null
          updated_at?: string
        }
        Update: {
          admin_level_1?: string | null
          bridged_to_normalized?: boolean | null
          confidence?: number | null
          confidence_tier?: string | null
          created_at?: string
          description?: string | null
          end_time?: string | null
          event_type?: string
          geo_entity_id?: string | null
          id?: string
          iso3?: string
          iso3_normalized?: string | null
          lat?: number | null
          locality?: string | null
          lon?: number | null
          matched_keywords?: Json | null
          proxy_boost?: number | null
          raw_signal_ids?: Json
          severity?: number | null
          source_count?: number
          start_time?: string
          status?: string
          subtype?: string | null
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "aicis_local_events_geo_entity_id_fkey"
            columns: ["geo_entity_id"]
            isOneToOne: false
            referencedRelation: "aicis_geo_entities"
            referencedColumns: ["id"]
          },
        ]
      }
      aicis_negative_entities: {
        Row: {
          category: string
          created_at: string
          phrase: string
        }
        Insert: {
          category?: string
          created_at?: string
          phrase: string
        }
        Update: {
          category?: string
          created_at?: string
          phrase?: string
        }
        Relationships: []
      }
      aicis_proxy_signals: {
        Row: {
          admin_level_1: string | null
          baseline: number | null
          created_at: string
          deviation: number | null
          id: string
          iso3: string
          lat: number | null
          locality: string | null
          lon: number | null
          metadata: Json | null
          signal_type: string
          source_name: string | null
          timestamp: string
          value: number | null
        }
        Insert: {
          admin_level_1?: string | null
          baseline?: number | null
          created_at?: string
          deviation?: number | null
          id?: string
          iso3: string
          lat?: number | null
          locality?: string | null
          lon?: number | null
          metadata?: Json | null
          signal_type: string
          source_name?: string | null
          timestamp?: string
          value?: number | null
        }
        Update: {
          admin_level_1?: string | null
          baseline?: number | null
          created_at?: string
          deviation?: number | null
          id?: string
          iso3?: string
          lat?: number | null
          locality?: string | null
          lon?: number | null
          metadata?: Json | null
          signal_type?: string
          source_name?: string | null
          timestamp?: string
          value?: number | null
        }
        Relationships: []
      }
      aicis_raw_local_signals: {
        Row: {
          claimed_at: string | null
          country_hint: string | null
          dedup_key: string | null
          id: string
          ingested_at: string
          language: string | null
          processed_at: string | null
          published_at: string | null
          raw_payload: Json | null
          raw_text: string | null
          region_hint: string | null
          source_name: string
          source_reliability: number | null
          source_type: string
          url: string | null
        }
        Insert: {
          claimed_at?: string | null
          country_hint?: string | null
          dedup_key?: string | null
          id?: string
          ingested_at?: string
          language?: string | null
          processed_at?: string | null
          published_at?: string | null
          raw_payload?: Json | null
          raw_text?: string | null
          region_hint?: string | null
          source_name: string
          source_reliability?: number | null
          source_type: string
          url?: string | null
        }
        Update: {
          claimed_at?: string | null
          country_hint?: string | null
          dedup_key?: string | null
          id?: string
          ingested_at?: string
          language?: string | null
          processed_at?: string | null
          published_at?: string | null
          raw_payload?: Json | null
          raw_text?: string | null
          region_hint?: string | null
          source_name?: string
          source_reliability?: number | null
          source_type?: string
          url?: string | null
        }
        Relationships: []
      }
      aicis_source_registry: {
        Row: {
          access_type: string
          created_at: string
          display_name: string | null
          domains: string[]
          feed_url: string | null
          id: string
          last_checked_at: string | null
          last_success_at: string | null
          notes: string | null
          region_focus: string[]
          reliability_score: number
          source_name: string
          source_type: string
          status: string
          updated_at: string
        }
        Insert: {
          access_type?: string
          created_at?: string
          display_name?: string | null
          domains?: string[]
          feed_url?: string | null
          id?: string
          last_checked_at?: string | null
          last_success_at?: string | null
          notes?: string | null
          region_focus?: string[]
          reliability_score?: number
          source_name: string
          source_type?: string
          status?: string
          updated_at?: string
        }
        Update: {
          access_type?: string
          created_at?: string
          display_name?: string | null
          domains?: string[]
          feed_url?: string | null
          id?: string
          last_checked_at?: string | null
          last_success_at?: string | null
          notes?: string | null
          region_focus?: string[]
          reliability_score?: number
          source_name?: string
          source_type?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      aicis_warning_evidence: {
        Row: {
          contribution: number | null
          local_event_id: string
          warning_id: string
        }
        Insert: {
          contribution?: number | null
          local_event_id: string
          warning_id: string
        }
        Update: {
          contribution?: number | null
          local_event_id?: string
          warning_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "aicis_warning_evidence_local_event_id_fkey"
            columns: ["local_event_id"]
            isOneToOne: false
            referencedRelation: "aicis_local_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aicis_warning_evidence_warning_id_fkey"
            columns: ["warning_id"]
            isOneToOne: false
            referencedRelation: "aicis_early_warnings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aicis_warning_evidence_warning_id_fkey"
            columns: ["warning_id"]
            isOneToOne: false
            referencedRelation: "v_lril_warning_false_positive_risk"
            referencedColumns: ["id"]
          },
        ]
      }
      aicis_warning_snapshots: {
        Row: {
          avg_confidence: number | null
          avg_escalation: number | null
          by_country: Json | null
          by_kind: Json | null
          id: string
          snapshot_at: string
          total_warnings: number
        }
        Insert: {
          avg_confidence?: number | null
          avg_escalation?: number | null
          by_country?: Json | null
          by_kind?: Json | null
          id?: string
          snapshot_at?: string
          total_warnings?: number
        }
        Update: {
          avg_confidence?: number | null
          avg_escalation?: number | null
          by_country?: Json | null
          by_kind?: Json | null
          id?: string
          snapshot_at?: string
          total_warnings?: number
        }
        Relationships: []
      }
      alert_preferences: {
        Row: {
          countries: string[]
          created_at: string
          divisions: string[]
          id: string
          min_severity: string
          mute_keywords: string[]
          show_acknowledged: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          countries?: string[]
          created_at?: string
          divisions?: string[]
          id?: string
          min_severity?: string
          mute_keywords?: string[]
          show_acknowledged?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          countries?: string[]
          created_at?: string
          divisions?: string[]
          id?: string
          min_severity?: string
          mute_keywords?: string[]
          show_acknowledged?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      alerts: {
        Row: {
          acknowledged: boolean | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          country: string | null
          created_at: string | null
          created_by: string | null
          division: string
          id: string
          message: string
          metadata: Json | null
          severity: string
          title: string
        }
        Insert: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          division: string
          id?: string
          message: string
          metadata?: Json | null
          severity: string
          title: string
        }
        Update: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          country?: string | null
          created_at?: string | null
          created_by?: string | null
          division?: string
          id?: string
          message?: string
          metadata?: Json | null
          severity?: string
          title?: string
        }
        Relationships: []
      }
      anomaly_detections: {
        Row: {
          anomaly_type: string
          baseline_metrics: Json | null
          created_at: string | null
          created_by: string | null
          description: string
          detected_at: string | null
          deviation_percentage: number | null
          division: string
          id: string
          metrics: Json
          notes: string | null
          resolved_at: string | null
          severity: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          anomaly_type: string
          baseline_metrics?: Json | null
          created_at?: string | null
          created_by?: string | null
          description: string
          detected_at?: string | null
          deviation_percentage?: number | null
          division: string
          id?: string
          metrics: Json
          notes?: string | null
          resolved_at?: string | null
          severity: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          anomaly_type?: string
          baseline_metrics?: Json | null
          created_at?: string | null
          created_by?: string | null
          description?: string
          detected_at?: string | null
          deviation_percentage?: number | null
          division?: string
          id?: string
          metrics?: Json
          notes?: string | null
          resolved_at?: string | null
          severity?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string | null
          created_by: string | null
          expires_at: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          org_id: string
          rate_limit_per_minute: number | null
          revoked: boolean | null
          revoked_at: string | null
          revoked_by: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          org_id: string
          rate_limit_per_minute?: number | null
          revoked?: boolean | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          expires_at?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          org_id?: string
          rate_limit_per_minute?: number | null
          revoked?: boolean | null
          revoked_at?: string | null
          revoked_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      api_request_audit: {
        Row: {
          api_key_id: string | null
          chain_hash: string
          created_at: string | null
          endpoint: string
          id: string
          latency_ms: number | null
          method: string
          org_id: string | null
          previous_chain_hash: string | null
          request_hash: string
          response_hash: string | null
          response_status: number
        }
        Insert: {
          api_key_id?: string | null
          chain_hash: string
          created_at?: string | null
          endpoint: string
          id?: string
          latency_ms?: number | null
          method: string
          org_id?: string | null
          previous_chain_hash?: string | null
          request_hash: string
          response_hash?: string | null
          response_status: number
        }
        Update: {
          api_key_id?: string | null
          chain_hash?: string
          created_at?: string | null
          endpoint?: string
          id?: string
          latency_ms?: number | null
          method?: string
          org_id?: string | null
          previous_chain_hash?: string | null
          request_hash?: string
          response_hash?: string | null
          response_status?: number
        }
        Relationships: []
      }
      approvals: {
        Row: {
          action: string
          created_at: string | null
          created_by: string | null
          decided_at: string | null
          decided_by: string | null
          division: string
          id: string
          payload: Json | null
          requester: string | null
          status: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          division: string
          id?: string
          payload?: Json | null
          requester?: string | null
          status?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          created_by?: string | null
          decided_at?: string | null
          decided_by?: string | null
          division?: string
          id?: string
          payload?: Json | null
          requester?: string | null
          status?: string | null
        }
        Relationships: []
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          id: string
          ip_address: unknown
          metadata: Json | null
          org_id: string | null
          request_id: string | null
          resource_id: string | null
          resource_type: string | null
          severity: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          org_id?: string | null
          request_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
          severity?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          org_id?: string | null
          request_id?: string | null
          resource_id?: string | null
          resource_type?: string | null
          severity?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      automation_logs: {
        Row: {
          executed_at: string | null
          id: string
          job_name: string
          message: string | null
          status: string
        }
        Insert: {
          executed_at?: string | null
          id?: string
          job_name: string
          message?: string | null
          status: string
        }
        Update: {
          executed_at?: string | null
          id?: string
          job_name?: string
          message?: string | null
          status?: string
        }
        Relationships: []
      }
      backfill_state: {
        Row: {
          key: string
          updated_at: string | null
          value_int: number | null
        }
        Insert: {
          key: string
          updated_at?: string | null
          value_int?: number | null
        }
        Update: {
          key?: string
          updated_at?: string | null
          value_int?: number | null
        }
        Relationships: []
      }
      billing_events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          org_id: string | null
          payload: Json | null
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          org_id?: string | null
          payload?: Json | null
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          org_id?: string | null
          payload?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_events_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_usage_queue: {
        Row: {
          id: string
          metric_key: string
          org_id: string | null
          processed: boolean | null
          quantity: number
          recorded_at: string | null
        }
        Insert: {
          id?: string
          metric_key: string
          org_id?: string | null
          processed?: boolean | null
          quantity: number
          recorded_at?: string | null
        }
        Update: {
          id?: string
          metric_key?: string
          org_id?: string | null
          processed?: boolean | null
          quantity?: number
          recorded_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "billing_usage_queue_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_usage_queue_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "billing_usage_queue_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_assets: {
        Row: {
          accent_color: string | null
          created_at: string | null
          custom_css: string | null
          favicon_url: string | null
          id: string
          logo_url: string | null
          metadata: Json | null
          org_id: string
          primary_color: string | null
          secondary_color: string | null
          updated_at: string | null
        }
        Insert: {
          accent_color?: string | null
          created_at?: string | null
          custom_css?: string | null
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          metadata?: Json | null
          org_id: string
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string | null
        }
        Update: {
          accent_color?: string | null
          created_at?: string | null
          custom_css?: string | null
          favicon_url?: string | null
          id?: string
          logo_url?: string | null
          metadata?: Json | null
          org_id?: string
          primary_color?: string | null
          secondary_color?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "brand_assets_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      calibration_audit_hashes: {
        Row: {
          calibration_profile_id: string | null
          computed_at: string
          hash_algorithm: string
          id: string
          metadata: Json | null
          model_version: string
          residual_count: number
          residual_sample_hash: string
        }
        Insert: {
          calibration_profile_id?: string | null
          computed_at?: string
          hash_algorithm?: string
          id?: string
          metadata?: Json | null
          model_version: string
          residual_count: number
          residual_sample_hash: string
        }
        Update: {
          calibration_profile_id?: string | null
          computed_at?: string
          hash_algorithm?: string
          id?: string
          metadata?: Json | null
          model_version?: string
          residual_count?: number
          residual_sample_hash?: string
        }
        Relationships: []
      }
      calibration_metrics: {
        Row: {
          calibration_params: Json | null
          computed_at: string
          domain: string | null
          id: string
          metric_name: string
          metric_value: number
          model_version: string
          sample_size: number
          window_end: string | null
          window_start: string | null
        }
        Insert: {
          calibration_params?: Json | null
          computed_at?: string
          domain?: string | null
          id?: string
          metric_name: string
          metric_value: number
          model_version: string
          sample_size?: number
          window_end?: string | null
          window_start?: string | null
        }
        Update: {
          calibration_params?: Json | null
          computed_at?: string
          domain?: string | null
          id?: string
          metric_name?: string
          metric_value?: number
          model_version?: string
          sample_size?: number
          window_end?: string | null
          window_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "calibration_metrics_model_version_fkey"
            columns: ["model_version"]
            isOneToOne: false
            referencedRelation: "model_registry"
            referencedColumns: ["model_version"]
          },
        ]
      }
      canary_probes: {
        Row: {
          details: Json | null
          id: string
          inserted_at: string
          probe_type: string
          propagated_to_links: boolean | null
          propagated_to_links_at: string | null
          propagation_lag_seconds: number | null
          source_record_id: string | null
          status: string
        }
        Insert: {
          details?: Json | null
          id?: string
          inserted_at?: string
          probe_type: string
          propagated_to_links?: boolean | null
          propagated_to_links_at?: string | null
          propagation_lag_seconds?: number | null
          source_record_id?: string | null
          status?: string
        }
        Update: {
          details?: Json | null
          id?: string
          inserted_at?: string
          probe_type?: string
          propagated_to_links?: boolean | null
          propagated_to_links_at?: string | null
          propagation_lag_seconds?: number | null
          source_record_id?: string | null
          status?: string
        }
        Relationships: []
      }
      canonical_entities: {
        Row: {
          canonical_name: string
          created_at: string
          display_name: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          id: string
          iso3: string | null
          last_resolved_at: string | null
          lat: number | null
          lon: number | null
          metadata: Json | null
          normalized_name: string | null
          source_count: number | null
          sovereignty_status:
            | Database["public"]["Enums"]["sovereignty_status"]
            | null
          trust_score: number | null
          updated_at: string
        }
        Insert: {
          canonical_name: string
          created_at?: string
          display_name?: string | null
          entity_type: Database["public"]["Enums"]["entity_type"]
          id?: string
          iso3?: string | null
          last_resolved_at?: string | null
          lat?: number | null
          lon?: number | null
          metadata?: Json | null
          normalized_name?: string | null
          source_count?: number | null
          sovereignty_status?:
            | Database["public"]["Enums"]["sovereignty_status"]
            | null
          trust_score?: number | null
          updated_at?: string
        }
        Update: {
          canonical_name?: string
          created_at?: string
          display_name?: string | null
          entity_type?: Database["public"]["Enums"]["entity_type"]
          id?: string
          iso3?: string | null
          last_resolved_at?: string | null
          lat?: number | null
          lon?: number | null
          metadata?: Json | null
          normalized_name?: string | null
          source_count?: number | null
          sovereignty_status?:
            | Database["public"]["Enums"]["sovereignty_status"]
            | null
          trust_score?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      command_history: {
        Row: {
          command: string
          created_at: string
          execution_time_ms: number | null
          id: string
          response: string | null
          success: boolean
          user_id: string
        }
        Insert: {
          command: string
          created_at?: string
          execution_time_ms?: number | null
          id?: string
          response?: string | null
          success?: boolean
          user_id: string
        }
        Update: {
          command?: string
          created_at?: string
          execution_time_ms?: number | null
          id?: string
          response?: string | null
          success?: boolean
          user_id?: string
        }
        Relationships: []
      }
      community_metrics: {
        Row: {
          captured_at: string
          country_iso3: string
          created_at: string
          domain: string
          id: string
          indicator_key: string
          metadata: Json | null
          region_id: string | null
          reporter_node_id: string | null
          source: string | null
          unit: string | null
          value: number
        }
        Insert: {
          captured_at?: string
          country_iso3: string
          created_at?: string
          domain: string
          id?: string
          indicator_key: string
          metadata?: Json | null
          region_id?: string | null
          reporter_node_id?: string | null
          source?: string | null
          unit?: string | null
          value: number
        }
        Update: {
          captured_at?: string
          country_iso3?: string
          created_at?: string
          domain?: string
          id?: string
          indicator_key?: string
          metadata?: Json | null
          region_id?: string | null
          reporter_node_id?: string | null
          source?: string | null
          unit?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "community_metrics_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "admin_regions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_metrics_reporter_node_id_fkey"
            columns: ["reporter_node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "community_metrics_reporter_node_id_fkey"
            columns: ["reporter_node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes_public"
            referencedColumns: ["id"]
          },
        ]
      }
      compliance_audit: {
        Row: {
          action_description: string
          action_type: string
          compliance_status: string
          created_at: string | null
          data_accessed: Json | null
          division: string | null
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action_description: string
          action_type: string
          compliance_status: string
          created_at?: string | null
          data_accessed?: Json | null
          division?: string | null
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action_description?: string
          action_type?: string
          compliance_status?: string
          created_at?: string | null
          data_accessed?: Json | null
          division?: string | null
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      conflict_signals: {
        Row: {
          assessment_md: string | null
          confidence: number | null
          conflict_intensity: number | null
          conflict_type: string | null
          country_iso3: string
          created_at: string | null
          data_sources: Json | null
          diplomatic_tension: number | null
          escalation_probability: number | null
          historical_parallels: Json | null
          id: string
          involved_parties: Json | null
          materialized_at: string | null
          media_hostility_index: number | null
          military_escalation: number | null
          protest_momentum: number | null
          region: string
          status: string | null
          time_to_conflict_days: number | null
          triggers: Json | null
          updated_at: string | null
        }
        Insert: {
          assessment_md?: string | null
          confidence?: number | null
          conflict_intensity?: number | null
          conflict_type?: string | null
          country_iso3: string
          created_at?: string | null
          data_sources?: Json | null
          diplomatic_tension?: number | null
          escalation_probability?: number | null
          historical_parallels?: Json | null
          id?: string
          involved_parties?: Json | null
          materialized_at?: string | null
          media_hostility_index?: number | null
          military_escalation?: number | null
          protest_momentum?: number | null
          region: string
          status?: string | null
          time_to_conflict_days?: number | null
          triggers?: Json | null
          updated_at?: string | null
        }
        Update: {
          assessment_md?: string | null
          confidence?: number | null
          conflict_intensity?: number | null
          conflict_type?: string | null
          country_iso3?: string
          created_at?: string | null
          data_sources?: Json | null
          diplomatic_tension?: number | null
          escalation_probability?: number | null
          historical_parallels?: Json | null
          id?: string
          involved_parties?: Json | null
          materialized_at?: string | null
          media_hostility_index?: number | null
          military_escalation?: number | null
          protest_momentum?: number | null
          region?: string
          status?: string | null
          time_to_conflict_days?: number | null
          triggers?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      country_performance_snapshots: {
        Row: {
          break_p_value: number | null
          confidence_score: number
          created_at: string
          data_gap_count: number | null
          data_stale_days: number | null
          domain: string
          forecast_1y: number | null
          forecast_90d: number | null
          forecast_direction: string
          forecast_stability_score: number
          id: string
          iso3: string
          momentum_score: number
          momentum_t_stat: number | null
          performance_index: number
          risk_pressure_score: number
          snapshot_date: string
          structural_break_count: number
          systemic_fragility_score: number
          volatility_index: number
        }
        Insert: {
          break_p_value?: number | null
          confidence_score?: number
          created_at?: string
          data_gap_count?: number | null
          data_stale_days?: number | null
          domain: string
          forecast_1y?: number | null
          forecast_90d?: number | null
          forecast_direction?: string
          forecast_stability_score?: number
          id?: string
          iso3: string
          momentum_score?: number
          momentum_t_stat?: number | null
          performance_index?: number
          risk_pressure_score?: number
          snapshot_date?: string
          structural_break_count?: number
          systemic_fragility_score?: number
          volatility_index?: number
        }
        Update: {
          break_p_value?: number | null
          confidence_score?: number
          created_at?: string
          data_gap_count?: number | null
          data_stale_days?: number | null
          domain?: string
          forecast_1y?: number | null
          forecast_90d?: number | null
          forecast_direction?: string
          forecast_stability_score?: number
          id?: string
          iso3?: string
          momentum_score?: number
          momentum_t_stat?: number | null
          performance_index?: number
          risk_pressure_score?: number
          snapshot_date?: string
          structural_break_count?: number
          systemic_fragility_score?: number
          volatility_index?: number
        }
        Relationships: []
      }
      country_profiles: {
        Row: {
          chartspec: Json | null
          compiled_at: string | null
          confidence: number | null
          country_name: string
          created_at: string | null
          id: string
          iso3: string
          kpis: Json | null
          mapspec: Json | null
          sources: Json | null
          summary: Json | null
          updated_at: string | null
        }
        Insert: {
          chartspec?: Json | null
          compiled_at?: string | null
          confidence?: number | null
          country_name: string
          created_at?: string | null
          id?: string
          iso3: string
          kpis?: Json | null
          mapspec?: Json | null
          sources?: Json | null
          summary?: Json | null
          updated_at?: string | null
        }
        Update: {
          chartspec?: Json | null
          compiled_at?: string | null
          confidence?: number | null
          country_name?: string
          created_at?: string | null
          id?: string
          iso3?: string
          kpis?: Json | null
          mapspec?: Json | null
          sources?: Json | null
          summary?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      crisis_events: {
        Row: {
          created_at: string | null
          created_by: string | null
          details_md: string | null
          id: string
          kind: string
          opened_at: string | null
          region: string
          resolved_at: string | null
          severity: number | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          details_md?: string | null
          id?: string
          kind: string
          opened_at?: string | null
          region: string
          resolved_at?: string | null
          severity?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          details_md?: string | null
          id?: string
          kind?: string
          opened_at?: string | null
          region?: string
          resolved_at?: string | null
          severity?: number | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      critical_alerts: {
        Row: {
          ack_by: string | null
          acknowledged: boolean | null
          country: string | null
          event_type: string | null
          headline: string
          id: string
          incident_id: string | null
          iso3: string | null
          level: string
          meta: Json | null
          severity: number | null
          triggered_at: string | null
        }
        Insert: {
          ack_by?: string | null
          acknowledged?: boolean | null
          country?: string | null
          event_type?: string | null
          headline: string
          id?: string
          incident_id?: string | null
          iso3?: string | null
          level: string
          meta?: Json | null
          severity?: number | null
          triggered_at?: string | null
        }
        Update: {
          ack_by?: string | null
          acknowledged?: boolean | null
          country?: string | null
          event_type?: string | null
          headline?: string
          id?: string
          incident_id?: string | null
          iso3?: string | null
          level?: string
          meta?: Json | null
          severity?: number | null
          triggered_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "critical_alerts_incident_id_fkey"
            columns: ["incident_id"]
            isOneToOne: false
            referencedRelation: "security_incidents"
            referencedColumns: ["id"]
          },
        ]
      }
      criticality_rules: {
        Row: {
          created_at: string
          criticality_tier: string
          domain: string
          id: string
          requires_dual_approval: boolean
          severity_threshold: number
        }
        Insert: {
          created_at?: string
          criticality_tier?: string
          domain: string
          id?: string
          requires_dual_approval?: boolean
          severity_threshold?: number
        }
        Update: {
          created_at?: string
          criticality_tier?: string
          domain?: string
          id?: string
          requires_dual_approval?: boolean
          severity_threshold?: number
        }
        Relationships: []
      }
      cross_border_signals: {
        Row: {
          affected_iso3: string[]
          created_at: string
          description: string | null
          detected_at: string
          domain: string
          id: string
          intensity: number | null
          metadata: Json | null
          origin_iso3: string
          signal_type: string
        }
        Insert: {
          affected_iso3?: string[]
          created_at?: string
          description?: string | null
          detected_at?: string
          domain: string
          id?: string
          intensity?: number | null
          metadata?: Json | null
          origin_iso3: string
          signal_type: string
        }
        Update: {
          affected_iso3?: string[]
          created_at?: string
          description?: string | null
          detected_at?: string
          domain?: string
          id?: string
          intensity?: number | null
          metadata?: Json | null
          origin_iso3?: string
          signal_type?: string
        }
        Relationships: []
      }
      cross_domain_influence: {
        Row: {
          computed_at: string | null
          generation_batch_id: string | null
          id: string
          lag_days: number | null
          region: string | null
          sample_size: number
          source_domain: string
          target_domain: string
          transfer_strength: number
        }
        Insert: {
          computed_at?: string | null
          generation_batch_id?: string | null
          id?: string
          lag_days?: number | null
          region?: string | null
          sample_size?: number
          source_domain: string
          target_domain: string
          transfer_strength: number
        }
        Update: {
          computed_at?: string | null
          generation_batch_id?: string | null
          id?: string
          lag_days?: number | null
          region?: string | null
          sample_size?: number
          source_domain?: string
          target_domain?: string
          transfer_strength?: number
        }
        Relationships: []
      }
      custom_domains: {
        Row: {
          created_at: string | null
          dns_configured: boolean | null
          domain: string
          error_message: string | null
          id: string
          last_check_at: string | null
          org_id: string
          ssl_enabled: boolean | null
          status: string | null
          updated_at: string | null
          verification_token: string
          verified: boolean | null
          verified_at: string | null
        }
        Insert: {
          created_at?: string | null
          dns_configured?: boolean | null
          domain: string
          error_message?: string | null
          id?: string
          last_check_at?: string | null
          org_id: string
          ssl_enabled?: boolean | null
          status?: string | null
          updated_at?: string | null
          verification_token: string
          verified?: boolean | null
          verified_at?: string | null
        }
        Update: {
          created_at?: string | null
          dns_configured?: boolean | null
          domain?: string
          error_message?: string | null
          id?: string
          last_check_at?: string | null
          org_id?: string
          ssl_enabled?: boolean | null
          status?: string | null
          updated_at?: string | null
          verification_token?: string
          verified?: boolean | null
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "custom_domains_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_domains_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "custom_domains_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      daily_system_health: {
        Row: {
          created_at: string | null
          decisions_captured: number | null
          executions_started: number | null
          health_date: string
          id: string
          inferences_generated: number | null
          measured_outcomes: number | null
          outcomes_recorded: number | null
        }
        Insert: {
          created_at?: string | null
          decisions_captured?: number | null
          executions_started?: number | null
          health_date?: string
          id?: string
          inferences_generated?: number | null
          measured_outcomes?: number | null
          outcomes_recorded?: number | null
        }
        Update: {
          created_at?: string | null
          decisions_captured?: number | null
          executions_started?: number | null
          health_date?: string
          id?: string
          inferences_generated?: number | null
          measured_outcomes?: number | null
          outcomes_recorded?: number | null
        }
        Relationships: []
      }
      daily_target_config: {
        Row: {
          created_at: string
          decisions_target: number
          executions_target: number
          id: string
          measured_target: number
          outcomes_target: number
          target_date: string
        }
        Insert: {
          created_at?: string
          decisions_target?: number
          executions_target?: number
          id?: string
          measured_target?: number
          outcomes_target?: number
          target_date?: string
        }
        Update: {
          created_at?: string
          decisions_target?: number
          executions_target?: number
          id?: string
          measured_target?: number
          outcomes_target?: number
          target_date?: string
        }
        Relationships: []
      }
      dao_proposals: {
        Row: {
          created_at: string
          description: string | null
          executed_at: string | null
          id: string
          proposal_type: string | null
          proposer_id: string | null
          space_id: string | null
          status: string
          title: string
          votes_abstain: number | null
          votes_against: number | null
          votes_for: number | null
          voting_ends_at: string
          voting_starts_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          executed_at?: string | null
          id?: string
          proposal_type?: string | null
          proposer_id?: string | null
          space_id?: string | null
          status?: string
          title: string
          votes_abstain?: number | null
          votes_against?: number | null
          votes_for?: number | null
          voting_ends_at?: string
          voting_starts_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          executed_at?: string | null
          id?: string
          proposal_type?: string | null
          proposer_id?: string | null
          space_id?: string | null
          status?: string
          title?: string
          votes_abstain?: number | null
          votes_against?: number | null
          votes_for?: number | null
          voting_ends_at?: string
          voting_starts_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dao_proposals_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "dao_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      dao_spaces: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          quorum_percentage: number | null
          voting_delay_hours: number | null
          voting_period_hours: number | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          quorum_percentage?: number | null
          voting_delay_hours?: number | null
          voting_period_hours?: number | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          quorum_percentage?: number | null
          voting_delay_hours?: number | null
          voting_period_hours?: number | null
        }
        Relationships: []
      }
      dao_stake_snapshots: {
        Row: {
          id: string
          snapshot_at: string
          space_id: string | null
          stake_amount: number
          user_id: string | null
        }
        Insert: {
          id?: string
          snapshot_at?: string
          space_id?: string | null
          stake_amount?: number
          user_id?: string | null
        }
        Update: {
          id?: string
          snapshot_at?: string
          space_id?: string | null
          stake_amount?: number
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dao_stake_snapshots_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "dao_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      dao_votes: {
        Row: {
          created_at: string
          id: string
          proposal_id: string | null
          vote_type: string
          voter_id: string | null
          voting_power: number
        }
        Insert: {
          created_at?: string
          id?: string
          proposal_id?: string | null
          vote_type: string
          voter_id?: string | null
          voting_power?: number
        }
        Update: {
          created_at?: string
          id?: string
          proposal_id?: string | null
          vote_type?: string
          voter_id?: string | null
          voting_power?: number
        }
        Relationships: [
          {
            foreignKeyName: "dao_votes_proposal_id_fkey"
            columns: ["proposal_id"]
            isOneToOne: false
            referencedRelation: "dao_proposals"
            referencedColumns: ["id"]
          },
        ]
      }
      data_access_control: {
        Row: {
          access_tier: Database["public"]["Enums"]["access_tier"]
          approved_purposes:
            | Database["public"]["Enums"]["data_purpose"][]
            | null
          created_at: string | null
          expires_at: string | null
          id: string
          jurisdiction: string | null
          node_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          access_tier?: Database["public"]["Enums"]["access_tier"]
          approved_purposes?:
            | Database["public"]["Enums"]["data_purpose"][]
            | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          jurisdiction?: string | null
          node_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          access_tier?: Database["public"]["Enums"]["access_tier"]
          approved_purposes?:
            | Database["public"]["Enums"]["data_purpose"][]
            | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          jurisdiction?: string | null
          node_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_access_control_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_access_control_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes_public"
            referencedColumns: ["id"]
          },
        ]
      }
      data_collection_triggers: {
        Row: {
          condition_config: Json
          condition_type: string
          created_at: string | null
          enabled: boolean | null
          id: string
          last_triggered: string | null
          priority: string | null
          target_endpoint: string
          target_source: string
          trigger_count: number | null
          trigger_name: string
          updated_at: string | null
        }
        Insert: {
          condition_config: Json
          condition_type: string
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          last_triggered?: string | null
          priority?: string | null
          target_endpoint: string
          target_source: string
          trigger_count?: number | null
          trigger_name: string
          updated_at?: string | null
        }
        Update: {
          condition_config?: Json
          condition_type?: string
          created_at?: string | null
          enabled?: boolean | null
          id?: string
          last_triggered?: string | null
          priority?: string | null
          target_endpoint?: string
          target_source?: string
          trigger_count?: number | null
          trigger_name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      data_deletion_requests: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          completed_at: string | null
          id: string
          reason: string | null
          rejection_reason: string | null
          requested_at: string
          status: string
          user_id: string
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          id?: string
          reason?: string | null
          rejection_reason?: string | null
          requested_at?: string
          status?: string
          user_id: string
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          completed_at?: string | null
          id?: string
          reason?: string | null
          rejection_reason?: string | null
          requested_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      data_export_requests: {
        Row: {
          completed_at: string | null
          error_message: string | null
          expires_at: string | null
          export_url: string | null
          id: string
          requested_at: string
          status: string
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          error_message?: string | null
          expires_at?: string | null
          export_url?: string | null
          id?: string
          requested_at?: string
          status?: string
          user_id: string
        }
        Update: {
          completed_at?: string | null
          error_message?: string | null
          expires_at?: string | null
          export_url?: string | null
          id?: string
          requested_at?: string
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      data_lifecycle_registry: {
        Row: {
          created_at: string | null
          criticality: string
          description: string | null
          growth_rate_daily: number | null
          id: string
          last_refreshed_at: string | null
          notes: string | null
          owner: string | null
          pipeline: string | null
          refresh_frequency: string | null
          retention_days: number | null
          row_count_estimate: number | null
          size_estimate_mb: number | null
          source: string | null
          staleness_threshold_hours: number | null
          status: string
          table_name: string
          tier: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          criticality?: string
          description?: string | null
          growth_rate_daily?: number | null
          id?: string
          last_refreshed_at?: string | null
          notes?: string | null
          owner?: string | null
          pipeline?: string | null
          refresh_frequency?: string | null
          retention_days?: number | null
          row_count_estimate?: number | null
          size_estimate_mb?: number | null
          source?: string | null
          staleness_threshold_hours?: number | null
          status?: string
          table_name: string
          tier?: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          criticality?: string
          description?: string | null
          growth_rate_daily?: number | null
          id?: string
          last_refreshed_at?: string | null
          notes?: string | null
          owner?: string | null
          pipeline?: string | null
          refresh_frequency?: string | null
          retention_days?: number | null
          row_count_estimate?: number | null
          size_estimate_mb?: number | null
          source?: string | null
          staleness_threshold_hours?: number | null
          status?: string
          table_name?: string
          tier?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      data_provenance: {
        Row: {
          adapter_version: string | null
          confidence: number | null
          created_at: string
          entity_match_confidence: number | null
          expires_at: string | null
          fact_id: string
          fact_type: string
          freshness_score: number | null
          id: string
          metadata: Json | null
          observed_at: string
          quality_score: number | null
          retrieved_at: string | null
          source_endpoint: string | null
          source_license: string | null
          source_provider: string
          source_url: string | null
        }
        Insert: {
          adapter_version?: string | null
          confidence?: number | null
          created_at?: string
          entity_match_confidence?: number | null
          expires_at?: string | null
          fact_id: string
          fact_type: string
          freshness_score?: number | null
          id?: string
          metadata?: Json | null
          observed_at?: string
          quality_score?: number | null
          retrieved_at?: string | null
          source_endpoint?: string | null
          source_license?: string | null
          source_provider: string
          source_url?: string | null
        }
        Update: {
          adapter_version?: string | null
          confidence?: number | null
          created_at?: string
          entity_match_confidence?: number | null
          expires_at?: string | null
          fact_id?: string
          fact_type?: string
          freshness_score?: number | null
          id?: string
          metadata?: Json | null
          observed_at?: string
          quality_score?: number | null
          retrieved_at?: string | null
          source_endpoint?: string | null
          source_license?: string | null
          source_provider?: string
          source_url?: string | null
        }
        Relationships: []
      }
      data_quality_audits: {
        Row: {
          audit_type: string
          created_at: string | null
          findings: Json | null
          id: string
          layer: string
          passed: boolean | null
          sample_size: number | null
          score: number | null
        }
        Insert: {
          audit_type: string
          created_at?: string | null
          findings?: Json | null
          id?: string
          layer: string
          passed?: boolean | null
          sample_size?: number | null
          score?: number | null
        }
        Update: {
          audit_type?: string
          created_at?: string | null
          findings?: Json | null
          id?: string
          layer?: string
          passed?: boolean | null
          sample_size?: number | null
          score?: number | null
        }
        Relationships: []
      }
      data_retention_policies: {
        Row: {
          auto_delete: boolean | null
          category: string
          created_at: string | null
          id: string
          max_days: number
          updated_at: string | null
        }
        Insert: {
          auto_delete?: boolean | null
          category: string
          created_at?: string | null
          id?: string
          max_days: number
          updated_at?: string | null
        }
        Update: {
          auto_delete?: boolean | null
          category?: string
          created_at?: string | null
          id?: string
          max_days?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      data_sharing_agreements: {
        Row: {
          agreement_type: string
          approved_at: string | null
          approved_by: string | null
          created_at: string | null
          expires_at: string | null
          id: string
          node_id: string | null
          sdg_tags: string[] | null
          signature: string
          signed_contract: Json
          status: string | null
        }
        Insert: {
          agreement_type: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          node_id?: string | null
          sdg_tags?: string[] | null
          signature: string
          signed_contract: Json
          status?: string | null
        }
        Update: {
          agreement_type?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string | null
          expires_at?: string | null
          id?: string
          node_id?: string | null
          sdg_tags?: string[] | null
          signature?: string
          signed_contract?: Json
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_sharing_agreements_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_sharing_agreements_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes_public"
            referencedColumns: ["id"]
          },
        ]
      }
      data_source_log: {
        Row: {
          created_at: string | null
          division: string
          error_message: string | null
          id: number
          last_success: string | null
          latency_ms: number | null
          records_ingested: number
          source: string
          status: string
        }
        Insert: {
          created_at?: string | null
          division: string
          error_message?: string | null
          id?: never
          last_success?: string | null
          latency_ms?: number | null
          records_ingested?: number
          source: string
          status: string
        }
        Update: {
          created_at?: string | null
          division?: string
          error_message?: string | null
          id?: never
          last_success?: string | null
          latency_ms?: number | null
          records_ingested?: number
          source?: string
          status?: string
        }
        Relationships: []
      }
      data_use_agreements: {
        Row: {
          agreement_text: string
          created_at: string | null
          data_categories: string[] | null
          effective_from: string
          expires_at: string | null
          id: string
          jurisdiction: string
          node_id: string | null
          purposes: Database["public"]["Enums"]["data_purpose"][] | null
          signature: string
          signed_by: string | null
          status: string | null
        }
        Insert: {
          agreement_text: string
          created_at?: string | null
          data_categories?: string[] | null
          effective_from: string
          expires_at?: string | null
          id?: string
          jurisdiction: string
          node_id?: string | null
          purposes?: Database["public"]["Enums"]["data_purpose"][] | null
          signature: string
          signed_by?: string | null
          status?: string | null
        }
        Update: {
          agreement_text?: string
          created_at?: string | null
          data_categories?: string[] | null
          effective_from?: string
          expires_at?: string | null
          id?: string
          jurisdiction?: string
          node_id?: string | null
          purposes?: Database["public"]["Enums"]["data_purpose"][] | null
          signature?: string
          signed_by?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "data_use_agreements_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "data_use_agreements_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes_public"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_criticality_rules: {
        Row: {
          created_at: string | null
          criticality_tier: string
          domain: string
          id: string
          min_impact_for_critical: number | null
          min_probability_for_critical: number | null
          policy: string
          requires_dual_approval: boolean
        }
        Insert: {
          created_at?: string | null
          criticality_tier?: string
          domain: string
          id?: string
          min_impact_for_critical?: number | null
          min_probability_for_critical?: number | null
          policy: string
          requires_dual_approval?: boolean
        }
        Update: {
          created_at?: string | null
          criticality_tier?: string
          domain?: string
          id?: string
          min_impact_for_critical?: number | null
          min_probability_for_critical?: number | null
          policy?: string
          requires_dual_approval?: boolean
        }
        Relationships: []
      }
      decision_inference_audit: {
        Row: {
          chosen_actions: Json
          created_at: string
          feature_vector: Json
          guardrail_flags: Json | null
          id: string
          inference_hash: string | null
          model_version: string
          policy_classifications: Json
          risk_score: number
          scope_domain: string | null
          scope_iso3: string | null
          signal_counts: Json | null
          training_mode: string
          weights_used: Json
        }
        Insert: {
          chosen_actions: Json
          created_at?: string
          feature_vector: Json
          guardrail_flags?: Json | null
          id?: string
          inference_hash?: string | null
          model_version: string
          policy_classifications: Json
          risk_score: number
          scope_domain?: string | null
          scope_iso3?: string | null
          signal_counts?: Json | null
          training_mode: string
          weights_used: Json
        }
        Update: {
          chosen_actions?: Json
          created_at?: string
          feature_vector?: Json
          guardrail_flags?: Json | null
          id?: string
          inference_hash?: string | null
          model_version?: string
          policy_classifications?: Json
          risk_score?: number
          scope_domain?: string | null
          scope_iso3?: string | null
          signal_counts?: Json | null
          training_mode?: string
          weights_used?: Json
        }
        Relationships: []
      }
      decision_metric_thresholds: {
        Row: {
          created_at: string | null
          enabled: boolean
          id: string
          metric_name: string
          min_acceptances: number
          min_measured_samples: number
          min_samples: number
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          enabled?: boolean
          id?: string
          metric_name: string
          min_acceptances?: number
          min_measured_samples?: number
          min_samples?: number
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          enabled?: boolean
          id?: string
          metric_name?: string
          min_acceptances?: number
          min_measured_samples?: number
          min_samples?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      decision_models: {
        Row: {
          action_adjustment_weights: Json | null
          action_policies: Json
          avg_impact_score: number | null
          compared_to_version: string | null
          confidence_calibration: Json | null
          created_at: string
          domain_action_policies: Json | null
          domain_feature_weights: Json | null
          feature_schema: Json
          feature_weights: Json
          id: string
          last_calibrated_at: string | null
          measured_sample_count: number
          model_type: string
          outcome_maturity_ratio: number | null
          performance_metrics: Json | null
          promoted_from_version: string | null
          promotion_status: string | null
          proxy_sample_count: number
          real_sample_count: number
          recommendation_acceptance_rate: number | null
          rejection_reason: string | null
          rollback_reason: string | null
          rollback_required: boolean | null
          rolled_back_from_version: string | null
          status: string
          training_mode: string
          training_sample_count: number | null
          version: string
        }
        Insert: {
          action_adjustment_weights?: Json | null
          action_policies?: Json
          avg_impact_score?: number | null
          compared_to_version?: string | null
          confidence_calibration?: Json | null
          created_at?: string
          domain_action_policies?: Json | null
          domain_feature_weights?: Json | null
          feature_schema: Json
          feature_weights?: Json
          id?: string
          last_calibrated_at?: string | null
          measured_sample_count?: number
          model_type: string
          outcome_maturity_ratio?: number | null
          performance_metrics?: Json | null
          promoted_from_version?: string | null
          promotion_status?: string | null
          proxy_sample_count?: number
          real_sample_count?: number
          recommendation_acceptance_rate?: number | null
          rejection_reason?: string | null
          rollback_reason?: string | null
          rollback_required?: boolean | null
          rolled_back_from_version?: string | null
          status?: string
          training_mode?: string
          training_sample_count?: number | null
          version: string
        }
        Update: {
          action_adjustment_weights?: Json | null
          action_policies?: Json
          avg_impact_score?: number | null
          compared_to_version?: string | null
          confidence_calibration?: Json | null
          created_at?: string
          domain_action_policies?: Json | null
          domain_feature_weights?: Json | null
          feature_schema?: Json
          feature_weights?: Json
          id?: string
          last_calibrated_at?: string | null
          measured_sample_count?: number
          model_type?: string
          outcome_maturity_ratio?: number | null
          performance_metrics?: Json | null
          promoted_from_version?: string | null
          promotion_status?: string | null
          proxy_sample_count?: number
          real_sample_count?: number
          recommendation_acceptance_rate?: number | null
          rejection_reason?: string | null
          rollback_reason?: string | null
          rollback_required?: boolean | null
          rolled_back_from_version?: string | null
          status?: string
          training_mode?: string
          training_sample_count?: number | null
          version?: string
        }
        Relationships: []
      }
      decision_outcome_log: {
        Row: {
          action_taken: boolean | null
          action_taken_at: string | null
          action_timestamp: string | null
          action_type: string | null
          action_window_days: number | null
          actor_role: string | null
          assigned_reviewer: string | null
          assigned_reviewer_role: string | null
          cost_of_action: number | null
          created_at: string | null
          criticality_tier: string | null
          decision_features: Json | null
          decision_id: string | null
          domain: string | null
          event_confirmed: boolean | null
          event_confirmed_date: string | null
          event_description: string | null
          evidence_checklist: Json | null
          evidence_note: string | null
          evidence_quality_score: number | null
          evidence_source_type: string | null
          evidence_type: string
          evidence_url: string | null
          execution_blocker: string | null
          execution_completed_at: string | null
          execution_note: string | null
          execution_owner: string | null
          execution_started_at: string | null
          execution_status: string | null
          hypothetical_decision_value: string | null
          id: string
          impact_score: number | null
          iso3: string | null
          measured_impact_score: number | null
          measured_outcome: string | null
          net_value: number | null
          outcome_confidence: string | null
          outcome_source: string | null
          outcome_success: boolean | null
          outcome_timestamp: string | null
          override_reason: string | null
          pilot_action_taken: string | null
          pilot_ended_at: string | null
          pilot_outcome: string | null
          pilot_partner: string | null
          pilot_started_at: string | null
          postmortem_note: string | null
          recommendation_accepted: boolean | null
          recommendation_rejected_reason: string | null
          recommended_action: string | null
          recommender_id: string | null
          recorded_at: string | null
          recorded_by: string | null
          requires_dual_approval: boolean | null
          review_completed_at: string | null
          review_due_at: string | null
          review_sla_hours: number | null
          review_status: string | null
          reviewer_name: string | null
          reviewer_role: string | null
          roi_estimate: number | null
          second_review_completed_at: string | null
          second_review_status: string | null
          second_reviewer_name: string | null
          second_reviewer_role: string | null
          separation_of_duties_verified: boolean | null
          signal_confidence: number | null
          signal_date: string
          signal_direction: string | null
          signal_id: string
          signal_title: string
          status: string
          time_to_outcome_days: number | null
          updated_at: string | null
        }
        Insert: {
          action_taken?: boolean | null
          action_taken_at?: string | null
          action_timestamp?: string | null
          action_type?: string | null
          action_window_days?: number | null
          actor_role?: string | null
          assigned_reviewer?: string | null
          assigned_reviewer_role?: string | null
          cost_of_action?: number | null
          created_at?: string | null
          criticality_tier?: string | null
          decision_features?: Json | null
          decision_id?: string | null
          domain?: string | null
          event_confirmed?: boolean | null
          event_confirmed_date?: string | null
          event_description?: string | null
          evidence_checklist?: Json | null
          evidence_note?: string | null
          evidence_quality_score?: number | null
          evidence_source_type?: string | null
          evidence_type?: string
          evidence_url?: string | null
          execution_blocker?: string | null
          execution_completed_at?: string | null
          execution_note?: string | null
          execution_owner?: string | null
          execution_started_at?: string | null
          execution_status?: string | null
          hypothetical_decision_value?: string | null
          id?: string
          impact_score?: number | null
          iso3?: string | null
          measured_impact_score?: number | null
          measured_outcome?: string | null
          net_value?: number | null
          outcome_confidence?: string | null
          outcome_source?: string | null
          outcome_success?: boolean | null
          outcome_timestamp?: string | null
          override_reason?: string | null
          pilot_action_taken?: string | null
          pilot_ended_at?: string | null
          pilot_outcome?: string | null
          pilot_partner?: string | null
          pilot_started_at?: string | null
          postmortem_note?: string | null
          recommendation_accepted?: boolean | null
          recommendation_rejected_reason?: string | null
          recommended_action?: string | null
          recommender_id?: string | null
          recorded_at?: string | null
          recorded_by?: string | null
          requires_dual_approval?: boolean | null
          review_completed_at?: string | null
          review_due_at?: string | null
          review_sla_hours?: number | null
          review_status?: string | null
          reviewer_name?: string | null
          reviewer_role?: string | null
          roi_estimate?: number | null
          second_review_completed_at?: string | null
          second_review_status?: string | null
          second_reviewer_name?: string | null
          second_reviewer_role?: string | null
          separation_of_duties_verified?: boolean | null
          signal_confidence?: number | null
          signal_date: string
          signal_direction?: string | null
          signal_id: string
          signal_title: string
          status?: string
          time_to_outcome_days?: number | null
          updated_at?: string | null
        }
        Update: {
          action_taken?: boolean | null
          action_taken_at?: string | null
          action_timestamp?: string | null
          action_type?: string | null
          action_window_days?: number | null
          actor_role?: string | null
          assigned_reviewer?: string | null
          assigned_reviewer_role?: string | null
          cost_of_action?: number | null
          created_at?: string | null
          criticality_tier?: string | null
          decision_features?: Json | null
          decision_id?: string | null
          domain?: string | null
          event_confirmed?: boolean | null
          event_confirmed_date?: string | null
          event_description?: string | null
          evidence_checklist?: Json | null
          evidence_note?: string | null
          evidence_quality_score?: number | null
          evidence_source_type?: string | null
          evidence_type?: string
          evidence_url?: string | null
          execution_blocker?: string | null
          execution_completed_at?: string | null
          execution_note?: string | null
          execution_owner?: string | null
          execution_started_at?: string | null
          execution_status?: string | null
          hypothetical_decision_value?: string | null
          id?: string
          impact_score?: number | null
          iso3?: string | null
          measured_impact_score?: number | null
          measured_outcome?: string | null
          net_value?: number | null
          outcome_confidence?: string | null
          outcome_source?: string | null
          outcome_success?: boolean | null
          outcome_timestamp?: string | null
          override_reason?: string | null
          pilot_action_taken?: string | null
          pilot_ended_at?: string | null
          pilot_outcome?: string | null
          pilot_partner?: string | null
          pilot_started_at?: string | null
          postmortem_note?: string | null
          recommendation_accepted?: boolean | null
          recommendation_rejected_reason?: string | null
          recommended_action?: string | null
          recommender_id?: string | null
          recorded_at?: string | null
          recorded_by?: string | null
          requires_dual_approval?: boolean | null
          review_completed_at?: string | null
          review_due_at?: string | null
          review_sla_hours?: number | null
          review_status?: string | null
          reviewer_name?: string | null
          reviewer_role?: string | null
          roi_estimate?: number | null
          second_review_completed_at?: string | null
          second_review_status?: string | null
          second_reviewer_name?: string | null
          second_reviewer_role?: string | null
          separation_of_duties_verified?: boolean | null
          signal_confidence?: number | null
          signal_date?: string
          signal_direction?: string | null
          signal_id?: string
          signal_title?: string
          status?: string
          time_to_outcome_days?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "decision_outcome_log_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "adi_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      decision_recommendation_runs: {
        Row: {
          created_at: string
          evidence_density: string
          global_assessment: string | null
          id: string
          model_used: string
          outcome_trained: boolean
          recommendation_count: number
          recommendations_payload: Json | null
          scope_country_iso3: string
          scope_domain: string
          signal_counts: Json
        }
        Insert: {
          created_at?: string
          evidence_density: string
          global_assessment?: string | null
          id?: string
          model_used: string
          outcome_trained?: boolean
          recommendation_count?: number
          recommendations_payload?: Json | null
          scope_country_iso3?: string
          scope_domain?: string
          signal_counts?: Json
        }
        Update: {
          created_at?: string
          evidence_density?: string
          global_assessment?: string | null
          id?: string
          model_used?: string
          outcome_trained?: boolean
          recommendation_count?: number
          recommendations_payload?: Json | null
          scope_country_iso3?: string
          scope_domain?: string
          signal_counts?: Json
        }
        Relationships: []
      }
      decision_review_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          changed_role: string | null
          decision_id: string
          from_status: string | null
          id: string
          note: string | null
          to_status: string
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          changed_role?: string | null
          decision_id: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status: string
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          changed_role?: string | null
          decision_id?: string
          from_status?: string | null
          id?: string
          note?: string | null
          to_status?: string
        }
        Relationships: [
          {
            foreignKeyName: "decision_review_history_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decision_outcome_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "decision_review_history_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "pilot_outcome_evidence_badges"
            referencedColumns: ["outcome_id"]
          },
        ]
      }
      decision_training_dataset: {
        Row: {
          action_type: string
          context_window_days: number | null
          created_at: string
          domain: string | null
          features: Json
          id: string
          impact_score: number | null
          iso3: string | null
          label_confidence: number | null
          label_source: string
          outcome_success: boolean | null
          overridden_by_real: boolean
          proxy_reason: string | null
          source_id: string | null
          source_type: string
        }
        Insert: {
          action_type: string
          context_window_days?: number | null
          created_at?: string
          domain?: string | null
          features: Json
          id?: string
          impact_score?: number | null
          iso3?: string | null
          label_confidence?: number | null
          label_source?: string
          outcome_success?: boolean | null
          overridden_by_real?: boolean
          proxy_reason?: string | null
          source_id?: string | null
          source_type?: string
        }
        Update: {
          action_type?: string
          context_window_days?: number | null
          created_at?: string
          domain?: string | null
          features?: Json
          id?: string
          impact_score?: number | null
          iso3?: string | null
          label_confidence?: number | null
          label_source?: string
          outcome_success?: boolean | null
          overridden_by_real?: boolean
          proxy_reason?: string | null
          source_id?: string | null
          source_type?: string
        }
        Relationships: []
      }
      defense_posture: {
        Row: {
          advisories_md: string | null
          created_at: string | null
          id: string
          region: string
          threat_level: number | null
          updated_at: string | null
        }
        Insert: {
          advisories_md?: string | null
          created_at?: string | null
          id?: string
          region: string
          threat_level?: number | null
          updated_at?: string | null
        }
        Update: {
          advisories_md?: string | null
          created_at?: string | null
          id?: string
          region?: string
          threat_level?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      diagnostics_log: {
        Row: {
          created_at: string | null
          failed_apis: Json | null
          failed_tables: string[] | null
          id: string
          latency_ms: number | null
          missing_env: string[] | null
          status: string
        }
        Insert: {
          created_at?: string | null
          failed_apis?: Json | null
          failed_tables?: string[] | null
          id?: string
          latency_ms?: number | null
          missing_env?: string[] | null
          status: string
        }
        Update: {
          created_at?: string | null
          failed_apis?: Json | null
          failed_tables?: string[] | null
          id?: string
          latency_ms?: number | null
          missing_env?: string[] | null
          status?: string
        }
        Relationships: []
      }
      diplo_signals: {
        Row: {
          country: string
          created_at: string | null
          id: string
          risk_index: number | null
          sentiment: number | null
          summary_md: string | null
          updated_at: string | null
        }
        Insert: {
          country: string
          created_at?: string | null
          id?: string
          risk_index?: number | null
          sentiment?: number | null
          summary_md?: string | null
          updated_at?: string | null
        }
        Update: {
          country?: string
          created_at?: string | null
          id?: string
          risk_index?: number | null
          sentiment?: number | null
          summary_md?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      division_impact_metrics: {
        Row: {
          captured_at: string | null
          division: string
          id: string
          impact_per_sc: number | null
          impact_score: number | null
          metric: Json
          rebalance_run_id: string | null
          sc_spent: number
        }
        Insert: {
          captured_at?: string | null
          division: string
          id?: string
          impact_per_sc?: number | null
          impact_score?: number | null
          metric: Json
          rebalance_run_id?: string | null
          sc_spent?: number
        }
        Update: {
          captured_at?: string | null
          division?: string
          id?: string
          impact_per_sc?: number | null
          impact_score?: number | null
          metric?: Json
          rebalance_run_id?: string | null
          sc_spent?: number
        }
        Relationships: [
          {
            foreignKeyName: "division_impact_metrics_rebalance_run_id_fkey"
            columns: ["rebalance_run_id"]
            isOneToOne: false
            referencedRelation: "sc_rebalance_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      division_kpis: {
        Row: {
          captured_at: string | null
          composite_score: number | null
          division: string
          id: string
          metric: Json
          risk_score: number | null
        }
        Insert: {
          captured_at?: string | null
          composite_score?: number | null
          division: string
          id?: string
          metric: Json
          risk_score?: number | null
        }
        Update: {
          captured_at?: string | null
          composite_score?: number | null
          division?: string
          id?: string
          metric?: Json
          risk_score?: number | null
        }
        Relationships: []
      }
      division_learning_weights: {
        Row: {
          division: string
          id: string
          impact_weight: number | null
          last_updated: string | null
          trend: number | null
        }
        Insert: {
          division: string
          id?: string
          impact_weight?: number | null
          last_updated?: string | null
          trend?: number | null
        }
        Update: {
          division?: string
          id?: string
          impact_weight?: number | null
          last_updated?: string | null
          trend?: number | null
        }
        Relationships: []
      }
      domain_coupling_matrix: {
        Row: {
          coupling_weight: number
          created_at: string
          evidence_note: string | null
          id: string
          model_version: string
          propagation_delay_days: number | null
          source_domain: string
          target_domain: string
        }
        Insert: {
          coupling_weight?: number
          created_at?: string
          evidence_note?: string | null
          id?: string
          model_version?: string
          propagation_delay_days?: number | null
          source_domain: string
          target_domain: string
        }
        Update: {
          coupling_weight?: number
          created_at?: string
          evidence_note?: string | null
          id?: string
          model_version?: string
          propagation_delay_days?: number | null
          source_domain?: string
          target_domain?: string
        }
        Relationships: []
      }
      domain_model_parameters: {
        Row: {
          alpha: number
          beta: number
          calibrated_at: string | null
          calibrated_rmse: number | null
          domain: string
          id: string
          iso3: string
        }
        Insert: {
          alpha?: number
          beta?: number
          calibrated_at?: string | null
          calibrated_rmse?: number | null
          domain: string
          id?: string
          iso3: string
        }
        Update: {
          alpha?: number
          beta?: number
          calibrated_at?: string | null
          calibrated_rmse?: number | null
          domain?: string
          id?: string
          iso3?: string
        }
        Relationships: []
      }
      domain_trust_scores: {
        Row: {
          accuracy: number | null
          brier_score: number | null
          calibration_error: number | null
          domain: string
          model_version: string | null
          sample_size: number
          trust_score: number
          updated_at: string
        }
        Insert: {
          accuracy?: number | null
          brier_score?: number | null
          calibration_error?: number | null
          domain: string
          model_version?: string | null
          sample_size?: number
          trust_score?: number
          updated_at?: string
        }
        Update: {
          accuracy?: number | null
          brier_score?: number | null
          calibration_error?: number | null
          domain?: string
          model_version?: string | null
          sample_size?: number
          trust_score?: number
          updated_at?: string
        }
        Relationships: []
      }
      domain_weights: {
        Row: {
          created_at: string
          domain: string
          id: string
          model_version: string
          rationale: string | null
          weight: number
        }
        Insert: {
          created_at?: string
          domain: string
          id?: string
          model_version: string
          rationale?: string | null
          weight: number
        }
        Update: {
          created_at?: string
          domain?: string
          id?: string
          model_version?: string
          rationale?: string | null
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "domain_weights_model_version_fkey"
            columns: ["model_version"]
            isOneToOne: false
            referencedRelation: "model_registry"
            referencedColumns: ["model_version"]
          },
        ]
      }
      dpia_logs: {
        Row: {
          approved: boolean | null
          approved_at: string | null
          approved_by: string | null
          assessment_type: string
          created_at: string | null
          data_categories: string[] | null
          id: string
          mitigation_measures: Json | null
          model_name: string | null
          risk_level: string
        }
        Insert: {
          approved?: boolean | null
          approved_at?: string | null
          approved_by?: string | null
          assessment_type: string
          created_at?: string | null
          data_categories?: string[] | null
          id?: string
          mitigation_measures?: Json | null
          model_name?: string | null
          risk_level: string
        }
        Update: {
          approved?: boolean | null
          approved_at?: string | null
          approved_by?: string | null
          assessment_type?: string
          created_at?: string | null
          data_categories?: string[] | null
          id?: string
          mitigation_measures?: Json | null
          model_name?: string | null
          risk_level?: string
        }
        Relationships: []
      }
      drift_alerts: {
        Row: {
          acknowledged: boolean
          acknowledged_by: string | null
          alert_type: string
          baseline_value: number | null
          created_at: string
          current_value: number | null
          details: Json | null
          deviation_pct: number | null
          id: string
          metric_name: string | null
          model_version: string
          severity: string
        }
        Insert: {
          acknowledged?: boolean
          acknowledged_by?: string | null
          alert_type: string
          baseline_value?: number | null
          created_at?: string
          current_value?: number | null
          details?: Json | null
          deviation_pct?: number | null
          id?: string
          metric_name?: string | null
          model_version: string
          severity?: string
        }
        Update: {
          acknowledged?: boolean
          acknowledged_by?: string | null
          alert_type?: string
          baseline_value?: number | null
          created_at?: string
          current_value?: number | null
          details?: Json | null
          deviation_pct?: number | null
          id?: string
          metric_name?: string | null
          model_version?: string
          severity?: string
        }
        Relationships: []
      }
      economic_indicators: {
        Row: {
          country: string
          created_at: string | null
          date: string
          id: string
          indicator_name: string
          metadata: Json | null
          source: string | null
          unit: string | null
          updated_at: string | null
          value: number
        }
        Insert: {
          country: string
          created_at?: string | null
          date: string
          id?: string
          indicator_name: string
          metadata?: Json | null
          source?: string | null
          unit?: string | null
          updated_at?: string | null
          value: number
        }
        Update: {
          country?: string
          created_at?: string | null
          date?: string
          id?: string
          indicator_name?: string
          metadata?: Json | null
          source?: string | null
          unit?: string | null
          updated_at?: string | null
          value?: number
        }
        Relationships: []
      }
      education_metrics: {
        Row: {
          country_iso3: string
          created_at: string
          id: string
          metric_name: string
          metric_value: number | null
          source: string | null
          updated_at: string
          year: number | null
        }
        Insert: {
          country_iso3: string
          created_at?: string
          id?: string
          metric_name: string
          metric_value?: number | null
          source?: string | null
          updated_at?: string
          year?: number | null
        }
        Update: {
          country_iso3?: string
          created_at?: string
          id?: string
          metric_name?: string
          metric_value?: number | null
          source?: string | null
          updated_at?: string
          year?: number | null
        }
        Relationships: []
      }
      election_calendar: {
        Row: {
          confidence: number | null
          created_at: string
          description: string | null
          election_date: string
          election_type: string
          id: string
          iso3: string
          source: string | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          description?: string | null
          election_date: string
          election_type: string
          id?: string
          iso3: string
          source?: string | null
        }
        Update: {
          confidence?: number | null
          created_at?: string
          description?: string | null
          election_date?: string
          election_type?: string
          id?: string
          iso3?: string
          source?: string | null
        }
        Relationships: []
      }
      energy_grid: {
        Row: {
          capacity: number
          created_at: string
          grid_load: number
          id: string
          outage_risk: Database["public"]["Enums"]["stability_status"]
          region: string
          renewable_percentage: number | null
          stability_index: number
          updated_at: string
        }
        Insert: {
          capacity: number
          created_at?: string
          grid_load: number
          id?: string
          outage_risk?: Database["public"]["Enums"]["stability_status"]
          region: string
          renewable_percentage?: number | null
          stability_index: number
          updated_at?: string
        }
        Update: {
          capacity?: number
          created_at?: string
          grid_load?: number
          id?: string
          outage_risk?: Database["public"]["Enums"]["stability_status"]
          region?: string
          renewable_percentage?: number | null
          stability_index?: number
          updated_at?: string
        }
        Relationships: []
      }
      entity_aliases: {
        Row: {
          alias: string
          alias_type: Database["public"]["Enums"]["entity_alias_type"]
          confidence: number | null
          created_at: string
          entity_id: string
          id: string
          source: string | null
        }
        Insert: {
          alias: string
          alias_type?: Database["public"]["Enums"]["entity_alias_type"]
          confidence?: number | null
          created_at?: string
          entity_id: string
          id?: string
          source?: string | null
        }
        Update: {
          alias?: string
          alias_type?: Database["public"]["Enums"]["entity_alias_type"]
          confidence?: number | null
          created_at?: string
          entity_id?: string
          id?: string
          source?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_aliases_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_aliases_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_aliases_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_aliases_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_aliases_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      entity_event_links: {
        Row: {
          confidence: number | null
          created_at: string
          entity_id: string
          event_id: string
          id: string
          link_role: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          entity_id: string
          event_id: string
          id?: string
          link_role?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          entity_id?: string
          event_id?: string
          id?: string
          link_role?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_event_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_event_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_event_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_event_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_event_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "entity_event_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "normalized_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_event_links_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "quantivis_event_feed"
            referencedColumns: ["event_id"]
          },
        ]
      }
      entity_external_ids: {
        Row: {
          created_at: string
          entity_id: string
          external_id: string
          external_type: string | null
          id: string
          last_verified_at: string | null
          provider: string
        }
        Insert: {
          created_at?: string
          entity_id: string
          external_id: string
          external_type?: string | null
          id?: string
          last_verified_at?: string | null
          provider: string
        }
        Update: {
          created_at?: string
          entity_id?: string
          external_id?: string
          external_type?: string | null
          id?: string
          last_verified_at?: string | null
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_external_ids_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_external_ids_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_external_ids_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_external_ids_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_external_ids_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      entity_links: {
        Row: {
          created_at: string
          id: string
          link_type: Database["public"]["Enums"]["entity_link_type"]
          metadata: Json | null
          provenance_confidence: number | null
          provenance_observed_at: string | null
          provenance_source: string | null
          source: string | null
          source_entity_id: string
          strength: number | null
          target_entity_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          link_type: Database["public"]["Enums"]["entity_link_type"]
          metadata?: Json | null
          provenance_confidence?: number | null
          provenance_observed_at?: string | null
          provenance_source?: string | null
          source?: string | null
          source_entity_id: string
          strength?: number | null
          target_entity_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          link_type?: Database["public"]["Enums"]["entity_link_type"]
          metadata?: Json | null
          provenance_confidence?: number | null
          provenance_observed_at?: string | null
          provenance_source?: string | null
          source?: string | null
          source_entity_id?: string
          strength?: number | null
          target_entity_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      entity_merge_log: {
        Row: {
          created_at: string
          id: string
          loser_id: string | null
          merge_confidence: number | null
          merge_reason: string
          merged_by: string | null
          metadata: Json | null
          winner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          loser_id?: string | null
          merge_confidence?: number | null
          merge_reason: string
          merged_by?: string | null
          metadata?: Json | null
          winner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          loser_id?: string | null
          merge_confidence?: number | null
          merge_reason?: string
          merged_by?: string | null
          metadata?: Json | null
          winner_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_merge_log_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_merge_log_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_merge_log_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_merge_log_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_merge_log_winner_id_fkey"
            columns: ["winner_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      entity_metric_links: {
        Row: {
          confidence: number | null
          created_at: string
          entity_id: string
          id: string
          link_role: string
          metric_id: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          entity_id: string
          id?: string
          link_role?: string
          metric_id: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          entity_id?: string
          id?: string
          link_role?: string
          metric_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "entity_metric_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_metric_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_metric_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_metric_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_metric_links_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "entity_metric_links_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "normalized_metrics"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_metric_links_metric_id_fkey"
            columns: ["metric_id"]
            isOneToOne: false
            referencedRelation: "quantivis_signals_feed"
            referencedColumns: ["signal_id"]
          },
        ]
      }
      ethics_audit_log: {
        Row: {
          assessment: string | null
          bias_index: number | null
          country: string | null
          created_at: string | null
          id: string
          reviewed_by: string | null
          source: string
        }
        Insert: {
          assessment?: string | null
          bias_index?: number | null
          country?: string | null
          created_at?: string | null
          id?: string
          reviewed_by?: string | null
          source: string
        }
        Update: {
          assessment?: string | null
          bias_index?: number | null
          country?: string | null
          created_at?: string | null
          id?: string
          reviewed_by?: string | null
          source?: string
        }
        Relationships: []
      }
      ethics_cases: {
        Row: {
          created_at: string | null
          decision_id: string | null
          id: string
          reason: string
          resolved_at: string | null
          reviewer_id: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          decision_id?: string | null
          id?: string
          reason: string
          resolved_at?: string | null
          reviewer_id?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          decision_id?: string | null
          id?: string
          reason?: string
          resolved_at?: string | null
          reviewer_id?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ethics_cases_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "ai_decision_logs"
            referencedColumns: ["id"]
          },
        ]
      }
      ethics_review_log: {
        Row: {
          approved: boolean
          assessment: string | null
          created_at: string
          decision_id: string | null
          flags: string[] | null
          id: string
          review_type: string
          reviewer_id: string | null
        }
        Insert: {
          approved?: boolean
          assessment?: string | null
          created_at?: string
          decision_id?: string | null
          flags?: string[] | null
          id?: string
          review_type?: string
          reviewer_id?: string | null
        }
        Update: {
          approved?: boolean
          assessment?: string | null
          created_at?: string
          decision_id?: string | null
          flags?: string[] | null
          id?: string
          review_type?: string
          reviewer_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ethics_review_log_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "adi_decisions"
            referencedColumns: ["id"]
          },
        ]
      }
      ethics_reviewers: {
        Row: {
          cert_level: string
          created_at: string | null
          id: string
          jurisdiction: string
          user_id: string
        }
        Insert: {
          cert_level: string
          created_at?: string | null
          id?: string
          jurisdiction: string
          user_id: string
        }
        Update: {
          cert_level?: string
          created_at?: string | null
          id?: string
          jurisdiction?: string
          user_id?: string
        }
        Relationships: []
      }
      evidence_enforcement_log: {
        Row: {
          created_at: string
          details: Json | null
          id: string
          issue_count: number
          issue_type: string
          scan_type: string
          severity: string
        }
        Insert: {
          created_at?: string
          details?: Json | null
          id?: string
          issue_count?: number
          issue_type: string
          scan_type?: string
          severity?: string
        }
        Update: {
          created_at?: string
          details?: Json | null
          id?: string
          issue_count?: number
          issue_type?: string
          scan_type?: string
          severity?: string
        }
        Relationships: []
      }
      exchange_accounts: {
        Row: {
          balance_usd: number
          connected_at: string
          exchange: string
          id: string
          status: string
          updated_at: string
        }
        Insert: {
          balance_usd?: number
          connected_at?: string
          exchange: string
          id?: string
          status?: string
          updated_at?: string
        }
        Update: {
          balance_usd?: number
          connected_at?: string
          exchange?: string
          id?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      feature_lineage: {
        Row: {
          computation_ts: string | null
          feature_version: string | null
          id: string
          notes: Json | null
          source_event_ids: string[] | null
          source_metric_ids: string[] | null
          training_row_id: string | null
        }
        Insert: {
          computation_ts?: string | null
          feature_version?: string | null
          id?: string
          notes?: Json | null
          source_event_ids?: string[] | null
          source_metric_ids?: string[] | null
          training_row_id?: string | null
        }
        Update: {
          computation_ts?: string | null
          feature_version?: string | null
          id?: string
          notes?: Json | null
          source_event_ids?: string[] | null
          source_metric_ids?: string[] | null
          training_row_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feature_lineage_training_row_id_fkey"
            columns: ["training_row_id"]
            isOneToOne: false
            referencedRelation: "training_dataset_aicis"
            referencedColumns: ["id"]
          },
        ]
      }
      federation_inbound_signals: {
        Row: {
          id: string
          peer_id: string | null
          peer_trust: number | null
          received_at: string | null
          signals: Json
          signature_valid: boolean | null
          summary_strength: number | null
          window_end: string
          window_start: string
        }
        Insert: {
          id?: string
          peer_id?: string | null
          peer_trust?: number | null
          received_at?: string | null
          signals: Json
          signature_valid?: boolean | null
          summary_strength?: number | null
          window_end: string
          window_start: string
        }
        Update: {
          id?: string
          peer_id?: string | null
          peer_trust?: number | null
          received_at?: string | null
          signals?: Json
          signature_valid?: boolean | null
          summary_strength?: number | null
          window_end?: string
          window_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "federation_inbound_signals_peer_id_fkey"
            columns: ["peer_id"]
            isOneToOne: false
            referencedRelation: "federation_peers"
            referencedColumns: ["id"]
          },
        ]
      }
      federation_learning_broadcasts: {
        Row: {
          broadcast_at: string
          broadcast_type: string
          created_at: string
          delivered_count: number | null
          id: string
          payload: Json
          source_tier: string
          target_tiers: string[]
        }
        Insert: {
          broadcast_at?: string
          broadcast_type?: string
          created_at?: string
          delivered_count?: number | null
          id?: string
          payload: Json
          source_tier?: string
          target_tiers?: string[]
        }
        Update: {
          broadcast_at?: string
          broadcast_type?: string
          created_at?: string
          delivered_count?: number | null
          id?: string
          payload?: Json
          source_tier?: string
          target_tiers?: string[]
        }
        Relationships: []
      }
      federation_outbound_queue: {
        Row: {
          attempts: number | null
          hash: string
          id: string
          last_attempt: string | null
          payload: Json
          status: string
          window_end: string
          window_start: string
        }
        Insert: {
          attempts?: number | null
          hash: string
          id?: string
          last_attempt?: string | null
          payload: Json
          status?: string
          window_end: string
          window_start: string
        }
        Update: {
          attempts?: number | null
          hash?: string
          id?: string
          last_attempt?: string | null
          payload?: Json
          status?: string
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      federation_peers: {
        Row: {
          base_url: string
          created_at: string | null
          id: string
          last_seen: string | null
          peer_name: string
          pubkey_pem: string
          recv_enabled: boolean | null
          send_enabled: boolean | null
          trust_score: number | null
        }
        Insert: {
          base_url: string
          created_at?: string | null
          id?: string
          last_seen?: string | null
          peer_name: string
          pubkey_pem: string
          recv_enabled?: boolean | null
          send_enabled?: boolean | null
          trust_score?: number | null
        }
        Update: {
          base_url?: string
          created_at?: string | null
          id?: string
          last_seen?: string | null
          peer_name?: string
          pubkey_pem?: string
          recv_enabled?: boolean | null
          send_enabled?: boolean | null
          trust_score?: number | null
        }
        Relationships: []
      }
      federation_policies: {
        Row: {
          data_classification: string | null
          dp_epsilon: number | null
          enabled: boolean | null
          id: string
          jurisdiction: string | null
          max_daily_weight_drift: number | null
          min_sample: number | null
          share_divisions: string[] | null
          updated_at: string | null
        }
        Insert: {
          data_classification?: string | null
          dp_epsilon?: number | null
          enabled?: boolean | null
          id?: string
          jurisdiction?: string | null
          max_daily_weight_drift?: number | null
          min_sample?: number | null
          share_divisions?: string[] | null
          updated_at?: string | null
        }
        Update: {
          data_classification?: string | null
          dp_epsilon?: number | null
          enabled?: boolean | null
          id?: string
          jurisdiction?: string | null
          max_daily_weight_drift?: number | null
          min_sample?: number | null
          share_divisions?: string[] | null
          updated_at?: string | null
        }
        Relationships: []
      }
      finance_data: {
        Row: {
          country: string
          created_at: string | null
          currency: string | null
          date: string
          id: string
          indicator_name: string
          iso_code: string | null
          metadata: Json | null
          source: string
          updated_at: string | null
          value: number
        }
        Insert: {
          country: string
          created_at?: string | null
          currency?: string | null
          date: string
          id?: string
          indicator_name: string
          iso_code?: string | null
          metadata?: Json | null
          source: string
          updated_at?: string | null
          value: number
        }
        Update: {
          country?: string
          created_at?: string | null
          currency?: string | null
          date?: string
          id?: string
          indicator_name?: string
          iso_code?: string | null
          metadata?: Json | null
          source?: string
          updated_at?: string | null
          value?: number
        }
        Relationships: []
      }
      food_data: {
        Row: {
          country: string
          created_at: string | null
          crop: string | null
          date: string
          id: string
          ipc_phase: number | null
          iso_code: string | null
          latitude: number | null
          longitude: number | null
          metadata: Json | null
          metric_name: string
          source: string
          unit: string | null
          updated_at: string | null
          value: number
        }
        Insert: {
          country: string
          created_at?: string | null
          crop?: string | null
          date: string
          id?: string
          ipc_phase?: number | null
          iso_code?: string | null
          latitude?: number | null
          longitude?: number | null
          metadata?: Json | null
          metric_name: string
          source: string
          unit?: string | null
          updated_at?: string | null
          value: number
        }
        Update: {
          country?: string
          created_at?: string | null
          crop?: string | null
          date?: string
          id?: string
          ipc_phase?: number | null
          iso_code?: string | null
          latitude?: number | null
          longitude?: number | null
          metadata?: Json | null
          metric_name?: string
          source?: string
          unit?: string | null
          updated_at?: string | null
          value?: number
        }
        Relationships: []
      }
      food_security: {
        Row: {
          alert_level: Database["public"]["Enums"]["alert_level"]
          created_at: string
          crop: string
          id: string
          metadata: Json | null
          notes: string | null
          region: string
          supply_days: number | null
          updated_at: string
          yield_index: number
        }
        Insert: {
          alert_level?: Database["public"]["Enums"]["alert_level"]
          created_at?: string
          crop: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          region: string
          supply_days?: number | null
          updated_at?: string
          yield_index: number
        }
        Update: {
          alert_level?: Database["public"]["Enums"]["alert_level"]
          created_at?: string
          crop?: string
          id?: string
          metadata?: Json | null
          notes?: string | null
          region?: string
          supply_days?: number | null
          updated_at?: string
          yield_index?: number
        }
        Relationships: []
      }
      forecast_archive: {
        Row: {
          alpha: number | null
          beta: number | null
          calibration_version: string | null
          confidence_score: number | null
          country_name: string
          created_at: string
          created_by: string | null
          data_quality_score: number | null
          data_stale_days: number | null
          domain: string
          forecast_1y: number | null
          forecast_90d: number | null
          forecast_lower_80: number | null
          forecast_lower_95: number | null
          forecast_upper_80: number | null
          forecast_upper_95: number | null
          gap_interpolation_count: number | null
          id: string
          iso3: string
          model_version: string
          parameter_set_id: string | null
          performance_index: number | null
          stability_score: number | null
          structural_break_flag: boolean | null
          structural_break_p_value: number | null
          training_window_end: string | null
        }
        Insert: {
          alpha?: number | null
          beta?: number | null
          calibration_version?: string | null
          confidence_score?: number | null
          country_name: string
          created_at?: string
          created_by?: string | null
          data_quality_score?: number | null
          data_stale_days?: number | null
          domain: string
          forecast_1y?: number | null
          forecast_90d?: number | null
          forecast_lower_80?: number | null
          forecast_lower_95?: number | null
          forecast_upper_80?: number | null
          forecast_upper_95?: number | null
          gap_interpolation_count?: number | null
          id?: string
          iso3: string
          model_version: string
          parameter_set_id?: string | null
          performance_index?: number | null
          stability_score?: number | null
          structural_break_flag?: boolean | null
          structural_break_p_value?: number | null
          training_window_end?: string | null
        }
        Update: {
          alpha?: number | null
          beta?: number | null
          calibration_version?: string | null
          confidence_score?: number | null
          country_name?: string
          created_at?: string
          created_by?: string | null
          data_quality_score?: number | null
          data_stale_days?: number | null
          domain?: string
          forecast_1y?: number | null
          forecast_90d?: number | null
          forecast_lower_80?: number | null
          forecast_lower_95?: number | null
          forecast_upper_80?: number | null
          forecast_upper_95?: number | null
          gap_interpolation_count?: number | null
          id?: string
          iso3?: string
          model_version?: string
          parameter_set_id?: string | null
          performance_index?: number | null
          stability_score?: number | null
          structural_break_flag?: boolean | null
          structural_break_p_value?: number | null
          training_window_end?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_archive_model_version_fkey"
            columns: ["model_version"]
            isOneToOne: false
            referencedRelation: "model_registry"
            referencedColumns: ["model_version"]
          },
        ]
      }
      forecast_domain_match_policies: {
        Row: {
          actual_source_table: string
          created_at: string
          direction_threshold_pct: number
          domain: string
          is_active: boolean
          match_window_days: number
          notes: string | null
          preferred_period_type: string | null
          timestamp_field: string
          updated_at: string
          value_field: string
        }
        Insert: {
          actual_source_table?: string
          created_at?: string
          direction_threshold_pct?: number
          domain: string
          is_active?: boolean
          match_window_days?: number
          notes?: string | null
          preferred_period_type?: string | null
          timestamp_field?: string
          updated_at?: string
          value_field?: string
        }
        Update: {
          actual_source_table?: string
          created_at?: string
          direction_threshold_pct?: number
          domain?: string
          is_active?: boolean
          match_window_days?: number
          notes?: string | null
          preferred_period_type?: string | null
          timestamp_field?: string
          updated_at?: string
          value_field?: string
        }
        Relationships: []
      }
      forecast_jobs: {
        Row: {
          attempts: number
          completed_at: string | null
          created_at: string
          domain: string
          error_message: string | null
          id: string
          idempotency_key: string | null
          iso3: string
          max_attempts: number
          model_version: string
          priority: number
          result: Json | null
          started_at: string | null
          status: string
        }
        Insert: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          domain: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          iso3: string
          max_attempts?: number
          model_version?: string
          priority?: number
          result?: Json | null
          started_at?: string | null
          status?: string
        }
        Update: {
          attempts?: number
          completed_at?: string | null
          created_at?: string
          domain?: string
          error_message?: string | null
          id?: string
          idempotency_key?: string | null
          iso3?: string
          max_attempts?: number
          model_version?: string
          priority?: number
          result?: Json | null
          started_at?: string | null
          status?: string
        }
        Relationships: []
      }
      forecast_outcomes: {
        Row: {
          absolute_error: number | null
          bias: number | null
          evaluated_at: string
          forecast_archive_id: string
          id: string
          inside_80_band: boolean | null
          inside_95_band: boolean | null
          realized_date: string | null
          realized_value: number | null
          squared_error: number | null
        }
        Insert: {
          absolute_error?: number | null
          bias?: number | null
          evaluated_at?: string
          forecast_archive_id: string
          id?: string
          inside_80_band?: boolean | null
          inside_95_band?: boolean | null
          realized_date?: string | null
          realized_value?: number | null
          squared_error?: number | null
        }
        Update: {
          absolute_error?: number | null
          bias?: number | null
          evaluated_at?: string
          forecast_archive_id?: string
          id?: string
          inside_80_band?: boolean | null
          inside_95_band?: boolean | null
          realized_date?: string | null
          realized_value?: number | null
          squared_error?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "forecast_outcomes_forecast_archive_id_fkey"
            columns: ["forecast_archive_id"]
            isOneToOne: true
            referencedRelation: "forecast_archive"
            referencedColumns: ["id"]
          },
        ]
      }
      forecast_prospective_evaluations: {
        Row: {
          absolute_error: number | null
          created_at: string
          direction_hit: boolean | null
          domain: string
          evaluation_locked: boolean
          evaluation_window: string
          forecast_id: string | null
          horizon_days: number
          id: string
          iso3: string
          metadata: Json | null
          model_version: string
          predicted_at: string
          predicted_direction: string
          predicted_value: number
          realization_due_at: string
          realized_at: string | null
          realized_direction: string | null
          realized_value: number | null
        }
        Insert: {
          absolute_error?: number | null
          created_at?: string
          direction_hit?: boolean | null
          domain: string
          evaluation_locked?: boolean
          evaluation_window?: string
          forecast_id?: string | null
          horizon_days: number
          id?: string
          iso3?: string
          metadata?: Json | null
          model_version: string
          predicted_at?: string
          predicted_direction: string
          predicted_value: number
          realization_due_at: string
          realized_at?: string | null
          realized_direction?: string | null
          realized_value?: number | null
        }
        Update: {
          absolute_error?: number | null
          created_at?: string
          direction_hit?: boolean | null
          domain?: string
          evaluation_locked?: boolean
          evaluation_window?: string
          forecast_id?: string | null
          horizon_days?: number
          id?: string
          iso3?: string
          metadata?: Json | null
          model_version?: string
          predicted_at?: string
          predicted_direction?: string
          predicted_value?: number
          realization_due_at?: string
          realized_at?: string | null
          realized_direction?: string | null
          realized_value?: number | null
        }
        Relationships: []
      }
      forecast_prospective_health_snapshots: {
        Row: {
          accumulation_status: string
          avg_mae: number | null
          countries_covered: number
          created_at: string
          domains_covered: number
          id: string
          missing_actual_count: number
          new_24h: number
          new_7d: number
          overdue_count: number
          pending_count: number
          readiness_status: string
          realized_count: number
          snapshot_date: string
          total_forecasts: number
          tp_accuracy: number | null
        }
        Insert: {
          accumulation_status?: string
          avg_mae?: number | null
          countries_covered?: number
          created_at?: string
          domains_covered?: number
          id?: string
          missing_actual_count?: number
          new_24h?: number
          new_7d?: number
          overdue_count?: number
          pending_count?: number
          readiness_status?: string
          realized_count?: number
          snapshot_date?: string
          total_forecasts?: number
          tp_accuracy?: number | null
        }
        Update: {
          accumulation_status?: string
          avg_mae?: number | null
          countries_covered?: number
          created_at?: string
          domains_covered?: number
          id?: string
          missing_actual_count?: number
          new_24h?: number
          new_7d?: number
          overdue_count?: number
          pending_count?: number
          readiness_status?: string
          realized_count?: number
          snapshot_date?: string
          total_forecasts?: number
          tp_accuracy?: number | null
        }
        Relationships: []
      }
      forecast_realization_runs: {
        Row: {
          error_message: string | null
          finished_at: string | null
          id: string
          limit_count: number
          rows_realized: number
          rows_skipped: number
          started_at: string
          status: string
        }
        Insert: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          limit_count: number
          rows_realized?: number
          rows_skipped?: number
          started_at?: string
          status?: string
        }
        Update: {
          error_message?: string | null
          finished_at?: string | null
          id?: string
          limit_count?: number
          rows_realized?: number
          rows_skipped?: number
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      forecast_residuals: {
        Row: {
          created_at: string
          decay_weight: number | null
          domain: string
          horizon_days: number
          id: string
          iso3: string | null
          model_version: string
          predicted_value: number
          realized_value: number
          regime_flag: string | null
          residual: number
        }
        Insert: {
          created_at?: string
          decay_weight?: number | null
          domain: string
          horizon_days?: number
          id?: string
          iso3?: string | null
          model_version: string
          predicted_value: number
          realized_value: number
          regime_flag?: string | null
          residual: number
        }
        Update: {
          created_at?: string
          decay_weight?: number | null
          domain?: string
          horizon_days?: number
          id?: string
          iso3?: string | null
          model_version?: string
          predicted_value?: number
          realized_value?: number
          regime_flag?: string | null
          residual?: number
        }
        Relationships: []
      }
      forecast_validation_edit_attempts: {
        Row: {
          attempted_at: string
          attempted_by: string | null
          blocked: boolean
          id: string
          new_row: Json | null
          old_row: Json | null
          operation: string
          reason: string | null
          target_id: string | null
        }
        Insert: {
          attempted_at?: string
          attempted_by?: string | null
          blocked?: boolean
          id?: string
          new_row?: Json | null
          old_row?: Json | null
          operation: string
          reason?: string | null
          target_id?: string | null
        }
        Update: {
          attempted_at?: string
          attempted_by?: string | null
          blocked?: boolean
          id?: string
          new_row?: Json | null
          old_row?: Json | null
          operation?: string
          reason?: string | null
          target_id?: string | null
        }
        Relationships: []
      }
      forecast_validation_results: {
        Row: {
          absolute_error: number | null
          actual_direction: string | null
          actual_value: number | null
          confidence_at_forecast: number | null
          created_at: string | null
          direction_hit: boolean | null
          domain: string
          forecast_archive_id: string | null
          forecast_date: string
          horizon_days: number
          id: string
          iso3: string
          percentage_error: number | null
          predicted_direction: string | null
          predicted_value: number | null
          realized_date: string
        }
        Insert: {
          absolute_error?: number | null
          actual_direction?: string | null
          actual_value?: number | null
          confidence_at_forecast?: number | null
          created_at?: string | null
          direction_hit?: boolean | null
          domain: string
          forecast_archive_id?: string | null
          forecast_date: string
          horizon_days: number
          id?: string
          iso3: string
          percentage_error?: number | null
          predicted_direction?: string | null
          predicted_value?: number | null
          realized_date: string
        }
        Update: {
          absolute_error?: number | null
          actual_direction?: string | null
          actual_value?: number | null
          confidence_at_forecast?: number | null
          created_at?: string | null
          direction_hit?: boolean | null
          domain?: string
          forecast_archive_id?: string | null
          forecast_date?: string
          horizon_days?: number
          id?: string
          iso3?: string
          percentage_error?: number | null
          predicted_direction?: string | null
          predicted_value?: number | null
          realized_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "forecast_validation_results_forecast_archive_id_fkey"
            columns: ["forecast_archive_id"]
            isOneToOne: false
            referencedRelation: "forecast_archive"
            referencedColumns: ["id"]
          },
        ]
      }
      geo_catalog: {
        Row: {
          bbox: number[] | null
          created_at: string | null
          fips: string | null
          id: string
          iso2: string | null
          iso3: string | null
          lat: number | null
          lon: number | null
          name: string
          raw: Json | null
          source: string
          type: string | null
        }
        Insert: {
          bbox?: number[] | null
          created_at?: string | null
          fips?: string | null
          id?: string
          iso2?: string | null
          iso3?: string | null
          lat?: number | null
          lon?: number | null
          name: string
          raw?: Json | null
          source: string
          type?: string | null
        }
        Update: {
          bbox?: number[] | null
          created_at?: string | null
          fips?: string | null
          id?: string
          iso2?: string | null
          iso3?: string | null
          lat?: number | null
          lon?: number | null
          name?: string
          raw?: Json | null
          source?: string
          type?: string | null
        }
        Relationships: []
      }
      global_domain_benchmarks: {
        Row: {
          domain: string
          id: string
          percentile_10: number
          percentile_25: number
          percentile_50: number
          percentile_75: number
          percentile_90: number
          structural_ceiling: number
          structural_floor: number
          updated_at: string
        }
        Insert: {
          domain: string
          id?: string
          percentile_10?: number
          percentile_25?: number
          percentile_50?: number
          percentile_75?: number
          percentile_90?: number
          structural_ceiling?: number
          structural_floor?: number
          updated_at?: string
        }
        Update: {
          domain?: string
          id?: string
          percentile_10?: number
          percentile_25?: number
          percentile_50?: number
          percentile_75?: number
          percentile_90?: number
          structural_ceiling?: number
          structural_floor?: number
          updated_at?: string
        }
        Relationships: []
      }
      global_signals: {
        Row: {
          affected_countries: string[] | null
          affected_regions: string[] | null
          affected_sectors: string[] | null
          affected_stakeholders: string[] | null
          audience_framing: Json | null
          canonical_source_name: string | null
          category: Database["public"]["Enums"]["signal_category"]
          classification_time_ms: number | null
          confidence_score: number
          created_at: string
          decision_candidates: Json | null
          dedup_key: string | null
          enriched_at: string | null
          enrichment_attempts: number | null
          enrichment_error: string | null
          enrichment_status: string | null
          event_cluster_id: string | null
          evidence_hash: string | null
          first_detected_at: string
          id: string
          impact_reasoning: string | null
          impact_score: number
          ingested_at: string | null
          ingestion_source: string | null
          latest_update_at: string
          likely_consequences: string | null
          merged_source_count: number | null
          misinformation_risk: number | null
          model_version: string | null
          multi_source_confirmed: boolean | null
          normalized_summary: string | null
          occurred_at: string | null
          official_source: boolean | null
          official_source_present: boolean | null
          primary_source: string | null
          recommended_actions: Json | null
          related_signal_ids: string[] | null
          routed_at: string | null
          routing_score: number | null
          routing_suppressed_reason: string | null
          routing_targets: string[] | null
          source_count: number
          source_rank_score: number | null
          source_references: Json | null
          source_trust_tier: string | null
          status: Database["public"]["Enums"]["signal_status"]
          strategic_implications: string | null
          subcategory: string | null
          summary: string
          title: string
          uncertainty_notes: string | null
          updated_at: string
          urgency_score: number
        }
        Insert: {
          affected_countries?: string[] | null
          affected_regions?: string[] | null
          affected_sectors?: string[] | null
          affected_stakeholders?: string[] | null
          audience_framing?: Json | null
          canonical_source_name?: string | null
          category: Database["public"]["Enums"]["signal_category"]
          classification_time_ms?: number | null
          confidence_score?: number
          created_at?: string
          decision_candidates?: Json | null
          dedup_key?: string | null
          enriched_at?: string | null
          enrichment_attempts?: number | null
          enrichment_error?: string | null
          enrichment_status?: string | null
          event_cluster_id?: string | null
          evidence_hash?: string | null
          first_detected_at?: string
          id?: string
          impact_reasoning?: string | null
          impact_score?: number
          ingested_at?: string | null
          ingestion_source?: string | null
          latest_update_at?: string
          likely_consequences?: string | null
          merged_source_count?: number | null
          misinformation_risk?: number | null
          model_version?: string | null
          multi_source_confirmed?: boolean | null
          normalized_summary?: string | null
          occurred_at?: string | null
          official_source?: boolean | null
          official_source_present?: boolean | null
          primary_source?: string | null
          recommended_actions?: Json | null
          related_signal_ids?: string[] | null
          routed_at?: string | null
          routing_score?: number | null
          routing_suppressed_reason?: string | null
          routing_targets?: string[] | null
          source_count?: number
          source_rank_score?: number | null
          source_references?: Json | null
          source_trust_tier?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          strategic_implications?: string | null
          subcategory?: string | null
          summary: string
          title: string
          uncertainty_notes?: string | null
          updated_at?: string
          urgency_score?: number
        }
        Update: {
          affected_countries?: string[] | null
          affected_regions?: string[] | null
          affected_sectors?: string[] | null
          affected_stakeholders?: string[] | null
          audience_framing?: Json | null
          canonical_source_name?: string | null
          category?: Database["public"]["Enums"]["signal_category"]
          classification_time_ms?: number | null
          confidence_score?: number
          created_at?: string
          decision_candidates?: Json | null
          dedup_key?: string | null
          enriched_at?: string | null
          enrichment_attempts?: number | null
          enrichment_error?: string | null
          enrichment_status?: string | null
          event_cluster_id?: string | null
          evidence_hash?: string | null
          first_detected_at?: string
          id?: string
          impact_reasoning?: string | null
          impact_score?: number
          ingested_at?: string | null
          ingestion_source?: string | null
          latest_update_at?: string
          likely_consequences?: string | null
          merged_source_count?: number | null
          misinformation_risk?: number | null
          model_version?: string | null
          multi_source_confirmed?: boolean | null
          normalized_summary?: string | null
          occurred_at?: string | null
          official_source?: boolean | null
          official_source_present?: boolean | null
          primary_source?: string | null
          recommended_actions?: Json | null
          related_signal_ids?: string[] | null
          routed_at?: string | null
          routing_score?: number | null
          routing_suppressed_reason?: string | null
          routing_targets?: string[] | null
          source_count?: number
          source_rank_score?: number | null
          source_references?: Json | null
          source_trust_tier?: string | null
          status?: Database["public"]["Enums"]["signal_status"]
          strategic_implications?: string | null
          subcategory?: string | null
          summary?: string
          title?: string
          uncertainty_notes?: string | null
          updated_at?: string
          urgency_score?: number
        }
        Relationships: []
      }
      gov_policies: {
        Row: {
          compliance_level: string | null
          created_at: string | null
          id: string
          jurisdiction: string
          last_reviewed: string | null
          source_url: string | null
          summary_md: string | null
          topic: string
          updated_at: string | null
        }
        Insert: {
          compliance_level?: string | null
          created_at?: string | null
          id?: string
          jurisdiction: string
          last_reviewed?: string | null
          source_url?: string | null
          summary_md?: string | null
          topic: string
          updated_at?: string | null
        }
        Update: {
          compliance_level?: string | null
          created_at?: string | null
          id?: string
          jurisdiction?: string
          last_reviewed?: string | null
          source_url?: string | null
          summary_md?: string | null
          topic?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      gov_readiness_scores: {
        Row: {
          details: Json | null
          evidence_score: number | null
          grade: string | null
          id: string
          ops_maturity_score: number | null
          overall_score: number | null
          reliability_score: number | null
          scored_at: string | null
          security_score: number | null
        }
        Insert: {
          details?: Json | null
          evidence_score?: number | null
          grade?: string | null
          id?: string
          ops_maturity_score?: number | null
          overall_score?: number | null
          reliability_score?: number | null
          scored_at?: string | null
          security_score?: number | null
        }
        Update: {
          details?: Json | null
          evidence_score?: number | null
          grade?: string | null
          id?: string
          ops_maturity_score?: number | null
          overall_score?: number | null
          reliability_score?: number | null
          scored_at?: string | null
          security_score?: number | null
        }
        Relationships: []
      }
      governance_assets: {
        Row: {
          asset_name: string
          asset_symbol: string
          created_at: string
          current_price: number
          enabled: boolean | null
          id: string
          market_cap: number | null
          metadata: Json | null
          price_change_24h: number | null
          total_supply: number | null
          updated_at: string
        }
        Insert: {
          asset_name: string
          asset_symbol: string
          created_at?: string
          current_price?: number
          enabled?: boolean | null
          id?: string
          market_cap?: number | null
          metadata?: Json | null
          price_change_24h?: number | null
          total_supply?: number | null
          updated_at?: string
        }
        Update: {
          asset_name?: string
          asset_symbol?: string
          created_at?: string
          current_price?: number
          enabled?: boolean | null
          id?: string
          market_cap?: number | null
          metadata?: Json | null
          price_change_24h?: number | null
          total_supply?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      governance_discrepancies: {
        Row: {
          decision_id: string | null
          description: string
          detected_at: string | null
          discrepancy_type: string
          id: string
          resolved: boolean | null
          resolved_at: string | null
          resolved_by: string | null
        }
        Insert: {
          decision_id?: string | null
          description: string
          detected_at?: string | null
          discrepancy_type: string
          id?: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Update: {
          decision_id?: string | null
          description?: string
          detected_at?: string | null
          discrepancy_type?: string
          id?: string
          resolved?: boolean | null
          resolved_at?: string | null
          resolved_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "governance_discrepancies_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "decision_outcome_log"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "governance_discrepancies_decision_id_fkey"
            columns: ["decision_id"]
            isOneToOne: false
            referencedRelation: "pilot_outcome_evidence_badges"
            referencedColumns: ["outcome_id"]
          },
        ]
      }
      governance_global: {
        Row: {
          category: string | null
          country: string
          created_at: string | null
          id: string
          indicator_name: string
          iso_code: string | null
          metadata: Json | null
          source: string
          updated_at: string | null
          value: number | null
          year: number
        }
        Insert: {
          category?: string | null
          country: string
          created_at?: string | null
          id?: string
          indicator_name: string
          iso_code?: string | null
          metadata?: Json | null
          source: string
          updated_at?: string | null
          value?: number | null
          year: number
        }
        Update: {
          category?: string | null
          country?: string
          created_at?: string | null
          id?: string
          indicator_name?: string
          iso_code?: string | null
          metadata?: Json | null
          source?: string
          updated_at?: string | null
          value?: number | null
          year?: number
        }
        Relationships: []
      }
      governance_trades: {
        Row: {
          asset_amount: number
          asset_symbol: string
          created_at: string
          executed_at: string | null
          id: string
          price: number
          sc_amount: number
          status: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          asset_amount: number
          asset_symbol: string
          created_at?: string
          executed_at?: string | null
          id?: string
          price?: number
          sc_amount: number
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          asset_amount?: number
          asset_symbol?: string
          created_at?: string
          executed_at?: string | null
          id?: string
          price?: number
          sc_amount?: number
          status?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      health_data: {
        Row: {
          affected_count: number
          containment_status: string | null
          created_at: string
          disease: string
          id: string
          metadata: Json | null
          mortality_rate: number | null
          region: string
          risk_level: Database["public"]["Enums"]["health_risk_level"]
          severity_index: number | null
          updated_at: string
        }
        Insert: {
          affected_count?: number
          containment_status?: string | null
          created_at?: string
          disease: string
          id?: string
          metadata?: Json | null
          mortality_rate?: number | null
          region: string
          risk_level: Database["public"]["Enums"]["health_risk_level"]
          severity_index?: number | null
          updated_at?: string
        }
        Update: {
          affected_count?: number
          containment_status?: string | null
          created_at?: string
          disease?: string
          id?: string
          metadata?: Json | null
          mortality_rate?: number | null
          region?: string
          risk_level?: Database["public"]["Enums"]["health_risk_level"]
          severity_index?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      health_metrics: {
        Row: {
          age_group: string | null
          country: string
          created_at: string | null
          date: string
          id: string
          iso_code: string | null
          metadata: Json | null
          metric_name: string
          sex: string | null
          source: string
          unit: string | null
          updated_at: string | null
          value: number
        }
        Insert: {
          age_group?: string | null
          country: string
          created_at?: string | null
          date: string
          id?: string
          iso_code?: string | null
          metadata?: Json | null
          metric_name: string
          sex?: string | null
          source: string
          unit?: string | null
          updated_at?: string | null
          value: number
        }
        Update: {
          age_group?: string | null
          country?: string
          created_at?: string | null
          date?: string
          id?: string
          iso_code?: string | null
          metadata?: Json | null
          metric_name?: string
          sex?: string | null
          source?: string
          unit?: string | null
          updated_at?: string | null
          value?: number
        }
        Relationships: []
      }
      ingestion_errors: {
        Row: {
          created_at: string
          error_detail: Json | null
          error_message: string
          id: string
          provider_run_id: string
          source_record: Json | null
          stage: string
        }
        Insert: {
          created_at?: string
          error_detail?: Json | null
          error_message: string
          id?: string
          provider_run_id: string
          source_record?: Json | null
          stage: string
        }
        Update: {
          created_at?: string
          error_detail?: Json | null
          error_message?: string
          id?: string
          provider_run_id?: string
          source_record?: Json | null
          stage?: string
        }
        Relationships: [
          {
            foreignKeyName: "ingestion_errors_provider_run_id_fkey"
            columns: ["provider_run_id"]
            isOneToOne: false
            referencedRelation: "provider_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      intel_events: {
        Row: {
          created_at: string | null
          description: string | null
          division: string
          event_type: string
          expires_at: string | null
          id: string
          payload: Json | null
          published_at: string | null
          published_by: string | null
          severity: string
          source_system: string | null
          title: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          division: string
          event_type: string
          expires_at?: string | null
          id?: string
          payload?: Json | null
          published_at?: string | null
          published_by?: string | null
          severity: string
          source_system?: string | null
          title: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          division?: string
          event_type?: string
          expires_at?: string | null
          id?: string
          payload?: Json | null
          published_at?: string | null
          published_by?: string | null
          severity?: string
          source_system?: string | null
          title?: string
        }
        Relationships: []
      }
      intelligence_index: {
        Row: {
          affected_divisions: string[]
          confidence_score: number | null
          created_at: string | null
          expires_at: string | null
          generated_at: string | null
          id: string
          index_type: string
          metrics: Json | null
          priority: number | null
          recommendations_md: string | null
          summary_md: string
          title: string
          updated_at: string | null
        }
        Insert: {
          affected_divisions: string[]
          confidence_score?: number | null
          created_at?: string | null
          expires_at?: string | null
          generated_at?: string | null
          id?: string
          index_type: string
          metrics?: Json | null
          priority?: number | null
          recommendations_md?: string | null
          summary_md: string
          title: string
          updated_at?: string | null
        }
        Update: {
          affected_divisions?: string[]
          confidence_score?: number | null
          created_at?: string | null
          expires_at?: string | null
          generated_at?: string | null
          id?: string
          index_type?: string
          metrics?: Json | null
          priority?: number | null
          recommendations_md?: string | null
          summary_md?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      intelligence_score_snapshots: {
        Row: {
          break_detection_hits: number | null
          break_detection_score: number | null
          break_detection_total: number | null
          change_period_pct: number | null
          created_at: string | null
          evaluation_window_days: number | null
          filtered_aicis_accuracy: number | null
          filtered_delta: number | null
          filtered_naive_accuracy: number | null
          id: string
          intelligence_grade: string | null
          lead_time_advantage_days: number | null
          metadata: Json | null
          naive_turning_point_accuracy: number | null
          snapshot_date: string
          total_forecasts_evaluated: number | null
          turning_point_accuracy: number | null
          turning_point_hits: number | null
          turning_point_total: number | null
          volatility_sensitivity: number | null
        }
        Insert: {
          break_detection_hits?: number | null
          break_detection_score?: number | null
          break_detection_total?: number | null
          change_period_pct?: number | null
          created_at?: string | null
          evaluation_window_days?: number | null
          filtered_aicis_accuracy?: number | null
          filtered_delta?: number | null
          filtered_naive_accuracy?: number | null
          id?: string
          intelligence_grade?: string | null
          lead_time_advantage_days?: number | null
          metadata?: Json | null
          naive_turning_point_accuracy?: number | null
          snapshot_date?: string
          total_forecasts_evaluated?: number | null
          turning_point_accuracy?: number | null
          turning_point_hits?: number | null
          turning_point_total?: number | null
          volatility_sensitivity?: number | null
        }
        Update: {
          break_detection_hits?: number | null
          break_detection_score?: number | null
          break_detection_total?: number | null
          change_period_pct?: number | null
          created_at?: string | null
          evaluation_window_days?: number | null
          filtered_aicis_accuracy?: number | null
          filtered_delta?: number | null
          filtered_naive_accuracy?: number | null
          id?: string
          intelligence_grade?: string | null
          lead_time_advantage_days?: number | null
          metadata?: Json | null
          naive_turning_point_accuracy?: number | null
          snapshot_date?: string
          total_forecasts_evaluated?: number | null
          turning_point_accuracy?: number | null
          turning_point_hits?: number | null
          turning_point_total?: number | null
          volatility_sensitivity?: number | null
        }
        Relationships: []
      }
      intelligence_signals: {
        Row: {
          acknowledged: boolean | null
          acknowledged_at: string | null
          acknowledged_by: string | null
          confidence: number | null
          countries: string[] | null
          created_at: string
          description: string
          domains: string[]
          escalation_reason: string | null
          evidence: Json | null
          expires_at: string | null
          id: string
          severity: string
          signal_type: string
          source_pages: string[] | null
          title: string
          updated_at: string
        }
        Insert: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          confidence?: number | null
          countries?: string[] | null
          created_at?: string
          description: string
          domains?: string[]
          escalation_reason?: string | null
          evidence?: Json | null
          expires_at?: string | null
          id?: string
          severity?: string
          signal_type: string
          source_pages?: string[] | null
          title: string
          updated_at?: string
        }
        Update: {
          acknowledged?: boolean | null
          acknowledged_at?: string | null
          acknowledged_by?: string | null
          confidence?: number | null
          countries?: string[] | null
          created_at?: string
          description?: string
          domains?: string[]
          escalation_reason?: string | null
          evidence?: Json | null
          expires_at?: string | null
          id?: string
          severity?: string
          signal_type?: string
          source_pages?: string[] | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      ip_access_control: {
        Row: {
          access_type: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          ip_address: unknown
          ip_range: unknown
          org_id: string | null
          reason: string | null
        }
        Insert: {
          access_type: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          ip_address: unknown
          ip_range?: unknown
          org_id?: string | null
          reason?: string | null
        }
        Update: {
          access_type?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          ip_address?: unknown
          ip_range?: unknown
          org_id?: string | null
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ip_access_control_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ip_access_control_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ip_access_control_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      ip_auto_block_rules: {
        Row: {
          block_duration_hours: number
          created_at: string
          enabled: boolean
          id: string
          rule_name: string
          threshold_count: number
          trigger_type: string
          window_minutes: number
        }
        Insert: {
          block_duration_hours?: number
          created_at?: string
          enabled?: boolean
          id?: string
          rule_name: string
          threshold_count?: number
          trigger_type: string
          window_minutes?: number
        }
        Update: {
          block_duration_hours?: number
          created_at?: string
          enabled?: boolean
          id?: string
          rule_name?: string
          threshold_count?: number
          trigger_type?: string
          window_minutes?: number
        }
        Relationships: []
      }
      iso_country_map: {
        Row: {
          iso2: string
          iso3: string
          name: string | null
        }
        Insert: {
          iso2: string
          iso3: string
          name?: string | null
        }
        Update: {
          iso2?: string
          iso3?: string
          name?: string | null
        }
        Relationships: []
      }
      ledger_entries: {
        Row: {
          block_number: number
          created_at: string | null
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          hash: string
          id: string
          node_id: string | null
          payload: Json
          previous_hash: string | null
          signature: string | null
          timestamp: string | null
          verified: boolean | null
        }
        Insert: {
          block_number?: number
          created_at?: string | null
          entry_type: Database["public"]["Enums"]["ledger_entry_type"]
          hash: string
          id?: string
          node_id?: string | null
          payload: Json
          previous_hash?: string | null
          signature?: string | null
          timestamp?: string | null
          verified?: boolean | null
        }
        Update: {
          block_number?: number
          created_at?: string | null
          entry_type?: Database["public"]["Enums"]["ledger_entry_type"]
          hash?: string
          id?: string
          node_id?: string | null
          payload?: Json
          previous_hash?: string | null
          signature?: string | null
          timestamp?: string | null
          verified?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "ledger_entries_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ledger_entries_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes_public"
            referencedColumns: ["id"]
          },
        ]
      }
      ledger_root_hashes: {
        Row: {
          block_count: number
          id: string
          metadata: Json | null
          root_hash: string
          timestamp: string | null
          verified: boolean | null
        }
        Insert: {
          block_count: number
          id?: string
          metadata?: Json | null
          root_hash: string
          timestamp?: string | null
          verified?: boolean | null
        }
        Update: {
          block_count?: number
          id?: string
          metadata?: Json | null
          root_hash?: string
          timestamp?: string | null
          verified?: boolean | null
        }
        Relationships: []
      }
      lril_country_corrections: {
        Row: {
          confidence_penalty: number | null
          created_at: string
          detected_iso3: string
          id: string
          original_country_hint: string | null
          raw_text_excerpt: string | null
          signal_id: string | null
          source_name: string | null
        }
        Insert: {
          confidence_penalty?: number | null
          created_at?: string
          detected_iso3: string
          id?: string
          original_country_hint?: string | null
          raw_text_excerpt?: string | null
          signal_id?: string | null
          source_name?: string | null
        }
        Update: {
          confidence_penalty?: number | null
          created_at?: string
          detected_iso3?: string
          id?: string
          original_country_hint?: string | null
          raw_text_excerpt?: string | null
          signal_id?: string | null
          source_name?: string | null
        }
        Relationships: []
      }
      lril_process_checkpoints: {
        Row: {
          created_at: string
          failed_count: number
          id: string
          last_batch_duration_ms: number | null
          processed_count: number
          remaining_unprocessed: number | null
          worker_id: string | null
        }
        Insert: {
          created_at?: string
          failed_count?: number
          id?: string
          last_batch_duration_ms?: number | null
          processed_count?: number
          remaining_unprocessed?: number | null
          worker_id?: string | null
        }
        Update: {
          created_at?: string
          failed_count?: number
          id?: string
          last_batch_duration_ms?: number | null
          processed_count?: number
          remaining_unprocessed?: number | null
          worker_id?: string | null
        }
        Relationships: []
      }
      methodology_documents: {
        Row: {
          content: Json
          document_version: number
          generated_at: string
          hash: string | null
          id: string
          model_version: string
        }
        Insert: {
          content: Json
          document_version?: number
          generated_at?: string
          hash?: string | null
          id?: string
          model_version: string
        }
        Update: {
          content?: Json
          document_version?: number
          generated_at?: string
          hash?: string | null
          id?: string
          model_version?: string
        }
        Relationships: []
      }
      metrics: {
        Row: {
          confidence: number | null
          created_at: string | null
          domain: string
          geo_id: string | null
          id: string
          iso3: string | null
          metric: string
          period: string | null
          raw: Json | null
          source: string | null
          unit: string | null
          value: number | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          domain: string
          geo_id?: string | null
          id?: string
          iso3?: string | null
          metric: string
          period?: string | null
          raw?: Json | null
          source?: string | null
          unit?: string | null
          value?: number | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          domain?: string
          geo_id?: string | null
          id?: string
          iso3?: string | null
          metric?: string
          period?: string | null
          raw?: Json | null
          source?: string | null
          unit?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "metrics_geo_id_fkey"
            columns: ["geo_id"]
            isOneToOne: false
            referencedRelation: "geo_catalog"
            referencedColumns: ["id"]
          },
        ]
      }
      microdata_indicators: {
        Row: {
          aggregation_method: string | null
          confidence_interval: Json | null
          country_iso3: string
          created_at: string | null
          domain: string
          id: string
          indicator: string
          region_name: string | null
          sample_size: number | null
          source_id: string
          unit: string | null
          value: number
          year: number
        }
        Insert: {
          aggregation_method?: string | null
          confidence_interval?: Json | null
          country_iso3: string
          created_at?: string | null
          domain: string
          id?: string
          indicator: string
          region_name?: string | null
          sample_size?: number | null
          source_id: string
          unit?: string | null
          value: number
          year: number
        }
        Update: {
          aggregation_method?: string | null
          confidence_interval?: Json | null
          country_iso3?: string
          created_at?: string | null
          domain?: string
          id?: string
          indicator?: string
          region_name?: string | null
          sample_size?: number | null
          source_id?: string
          unit?: string | null
          value?: number
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "microdata_indicators_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "microdata_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      microdata_sources: {
        Row: {
          aggregation_level: string
          countries: string[] | null
          created_at: string | null
          dataset_id: string
          deidentification_status: string
          description: string | null
          domains: string[] | null
          error_message: string | null
          id: string
          indicator_count: number | null
          ingested_at: string | null
          license_type: string
          license_url: string | null
          metadata: Json | null
          provider: string
          record_count: number | null
          source_name: string
          status: string
          title: string
          updated_at: string | null
          years: number[] | null
        }
        Insert: {
          aggregation_level?: string
          countries?: string[] | null
          created_at?: string | null
          dataset_id: string
          deidentification_status?: string
          description?: string | null
          domains?: string[] | null
          error_message?: string | null
          id?: string
          indicator_count?: number | null
          ingested_at?: string | null
          license_type: string
          license_url?: string | null
          metadata?: Json | null
          provider: string
          record_count?: number | null
          source_name: string
          status?: string
          title: string
          updated_at?: string | null
          years?: number[] | null
        }
        Update: {
          aggregation_level?: string
          countries?: string[] | null
          created_at?: string | null
          dataset_id?: string
          deidentification_status?: string
          description?: string | null
          domains?: string[] | null
          error_message?: string | null
          id?: string
          indicator_count?: number | null
          ingested_at?: string | null
          license_type?: string
          license_url?: string | null
          metadata?: Json | null
          provider?: string
          record_count?: number | null
          source_name?: string
          status?: string
          title?: string
          updated_at?: string | null
          years?: number[] | null
        }
        Relationships: []
      }
      milestone_audit_log: {
        Row: {
          audited_at: string
          checks: Json
          id: string
          metrics_at_audit: number
          milestone: string
          passed: boolean
        }
        Insert: {
          audited_at?: string
          checks: Json
          id?: string
          metrics_at_audit: number
          milestone: string
          passed: boolean
        }
        Update: {
          audited_at?: string
          checks?: Json
          id?: string
          metrics_at_audit?: number
          milestone?: string
          passed?: boolean
        }
        Relationships: []
      }
      ml_inference_audit: {
        Row: {
          combined_hash: string
          feature_hash: string
          generated_at: string | null
          id: string
          model_version: string
          prediction_id: string | null
          previous_audit_hash: string | null
          weights_hash: string
        }
        Insert: {
          combined_hash: string
          feature_hash: string
          generated_at?: string | null
          id?: string
          model_version: string
          prediction_id?: string | null
          previous_audit_hash?: string | null
          weights_hash: string
        }
        Update: {
          combined_hash?: string
          feature_hash?: string
          generated_at?: string | null
          id?: string
          model_version?: string
          prediction_id?: string | null
          previous_audit_hash?: string | null
          weights_hash?: string
        }
        Relationships: [
          {
            foreignKeyName: "ml_inference_audit_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: false
            referencedRelation: "risk_ml_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      ml_model_weights: {
        Row: {
          active: boolean | null
          created_at: string | null
          id: string
          model_type: string
          model_version: string
          trained_at: string | null
          training_rows: number | null
          validation_auc: number | null
          weights: Json
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          model_type?: string
          model_version: string
          trained_at?: string | null
          training_rows?: number | null
          validation_auc?: number | null
          weights: Json
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          id?: string
          model_type?: string
          model_version?: string
          trained_at?: string | null
          training_rows?: number | null
          validation_auc?: number | null
          weights?: Json
        }
        Relationships: []
      }
      model_calibration_bins: {
        Row: {
          bin_lower: number
          bin_upper: number
          computed_at: string | null
          domain: string
          empirical_rate: number
          id: string
          model_version: string
          predicted_mean: number
          sample_count: number
        }
        Insert: {
          bin_lower: number
          bin_upper: number
          computed_at?: string | null
          domain: string
          empirical_rate: number
          id?: string
          model_version: string
          predicted_mean: number
          sample_count?: number
        }
        Update: {
          bin_lower?: number
          bin_upper?: number
          computed_at?: string | null
          domain?: string
          empirical_rate?: number
          id?: string
          model_version?: string
          predicted_mean?: number
          sample_count?: number
        }
        Relationships: []
      }
      model_calibration_profiles: {
        Row: {
          created_at: string
          fitted_at: string
          id: string
          locked_until: string | null
          model_version: string
          platt_a: number
          platt_b: number
          sample_size: number
          status: string
        }
        Insert: {
          created_at?: string
          fitted_at?: string
          id?: string
          locked_until?: string | null
          model_version: string
          platt_a?: number
          platt_b?: number
          sample_size?: number
          status?: string
        }
        Update: {
          created_at?: string
          fitted_at?: string
          id?: string
          locked_until?: string | null
          model_version?: string
          platt_a?: number
          platt_b?: number
          sample_size?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_calibration_profiles_model_version_fkey"
            columns: ["model_version"]
            isOneToOne: false
            referencedRelation: "model_registry"
            referencedColumns: ["model_version"]
          },
        ]
      }
      model_evaluations: {
        Row: {
          acceptance_rate: number | null
          act_precision: number | null
          avg_impact_score: number | null
          avg_roi: number | null
          calibration_error: number | null
          compared_to_version: string | null
          confidence_buckets: Json | null
          consider_precision: number | null
          evaluated_at: string | null
          evaluation_type: string
          heuristic_success_rate: number | null
          id: string
          improvement_over_heuristic: number | null
          improvement_over_previous: number | null
          measured_count: number | null
          measured_success_rate: number | null
          metadata: Json | null
          model_version: string
          proxy_success_rate: number | null
          real_success_rate: number | null
          sample_count: number | null
          total_net_value: number | null
        }
        Insert: {
          acceptance_rate?: number | null
          act_precision?: number | null
          avg_impact_score?: number | null
          avg_roi?: number | null
          calibration_error?: number | null
          compared_to_version?: string | null
          confidence_buckets?: Json | null
          consider_precision?: number | null
          evaluated_at?: string | null
          evaluation_type?: string
          heuristic_success_rate?: number | null
          id?: string
          improvement_over_heuristic?: number | null
          improvement_over_previous?: number | null
          measured_count?: number | null
          measured_success_rate?: number | null
          metadata?: Json | null
          model_version: string
          proxy_success_rate?: number | null
          real_success_rate?: number | null
          sample_count?: number | null
          total_net_value?: number | null
        }
        Update: {
          acceptance_rate?: number | null
          act_precision?: number | null
          avg_impact_score?: number | null
          avg_roi?: number | null
          calibration_error?: number | null
          compared_to_version?: string | null
          confidence_buckets?: Json | null
          consider_precision?: number | null
          evaluated_at?: string | null
          evaluation_type?: string
          heuristic_success_rate?: number | null
          id?: string
          improvement_over_heuristic?: number | null
          improvement_over_previous?: number | null
          measured_count?: number | null
          measured_success_rate?: number | null
          metadata?: Json | null
          model_version?: string
          proxy_success_rate?: number | null
          real_success_rate?: number | null
          sample_count?: number | null
          total_net_value?: number | null
        }
        Relationships: []
      }
      model_performance_log: {
        Row: {
          accuracy: number | null
          auc: number | null
          bias: number | null
          bias_by_region: Json | null
          brier_score: number | null
          calibration_error: number | null
          computed_at: string
          domain: string
          ece: number | null
          id: string
          log_loss: number | null
          model_version: string
          positive_rate_actual: number | null
          positive_rate_predicted: number | null
          realization_count: number | null
          sample_size: number
          surprise_rate: number | null
          trust_score: number | null
          window_end: string
          window_start: string
        }
        Insert: {
          accuracy?: number | null
          auc?: number | null
          bias?: number | null
          bias_by_region?: Json | null
          brier_score?: number | null
          calibration_error?: number | null
          computed_at?: string
          domain: string
          ece?: number | null
          id?: string
          log_loss?: number | null
          model_version: string
          positive_rate_actual?: number | null
          positive_rate_predicted?: number | null
          realization_count?: number | null
          sample_size: number
          surprise_rate?: number | null
          trust_score?: number | null
          window_end: string
          window_start: string
        }
        Update: {
          accuracy?: number | null
          auc?: number | null
          bias?: number | null
          bias_by_region?: Json | null
          brier_score?: number | null
          calibration_error?: number | null
          computed_at?: string
          domain?: string
          ece?: number | null
          id?: string
          log_loss?: number | null
          model_version?: string
          positive_rate_actual?: number | null
          positive_rate_predicted?: number | null
          realization_count?: number | null
          sample_size?: number
          surprise_rate?: number | null
          trust_score?: number | null
          window_end?: string
          window_start?: string
        }
        Relationships: []
      }
      model_promotion_decisions: {
        Row: {
          challenger_auc: number | null
          challenger_brier: number | null
          challenger_ece: number | null
          challenger_version: string
          champion_auc: number | null
          champion_brier: number | null
          champion_ece: number | null
          champion_version: string
          decided_at: string | null
          decision: string
          domain: string
          id: string
          notes: Json | null
          p_value: number | null
          realization_count: number
        }
        Insert: {
          challenger_auc?: number | null
          challenger_brier?: number | null
          challenger_ece?: number | null
          challenger_version: string
          champion_auc?: number | null
          champion_brier?: number | null
          champion_ece?: number | null
          champion_version: string
          decided_at?: string | null
          decision: string
          domain: string
          id?: string
          notes?: Json | null
          p_value?: number | null
          realization_count?: number
        }
        Update: {
          challenger_auc?: number | null
          challenger_brier?: number | null
          challenger_ece?: number | null
          challenger_version?: string
          champion_auc?: number | null
          champion_brier?: number | null
          champion_ece?: number | null
          champion_version?: string
          decided_at?: string | null
          decision?: string
          domain?: string
          id?: string
          notes?: Json | null
          p_value?: number | null
          realization_count?: number
        }
        Relationships: []
      }
      model_registry: {
        Row: {
          alpha_default: number
          beta_default: number
          created_at: string
          fragility_model_version: string
          git_commit_hash: string | null
          id: string
          model_status: string
          model_version: string
          notes: string | null
          promoted_at: string | null
          promotion_p_value: number | null
          promotion_test_statistic: number | null
          release_date: string
          status: string
          structural_break_method: string
          weight_vector_hash: string | null
        }
        Insert: {
          alpha_default?: number
          beta_default?: number
          created_at?: string
          fragility_model_version?: string
          git_commit_hash?: string | null
          id?: string
          model_status?: string
          model_version: string
          notes?: string | null
          promoted_at?: string | null
          promotion_p_value?: number | null
          promotion_test_statistic?: number | null
          release_date?: string
          status?: string
          structural_break_method?: string
          weight_vector_hash?: string | null
        }
        Update: {
          alpha_default?: number
          beta_default?: number
          created_at?: string
          fragility_model_version?: string
          git_commit_hash?: string | null
          id?: string
          model_status?: string
          model_version?: string
          notes?: string | null
          promoted_at?: string | null
          promotion_p_value?: number | null
          promotion_test_statistic?: number | null
          release_date?: string
          status?: string
          structural_break_method?: string
          weight_vector_hash?: string | null
        }
        Relationships: []
      }
      model_rollback_history: {
        Row: {
          calibration_error: number | null
          created_at: string | null
          id: string
          improvement_over_heuristic: number | null
          rollback_reason: string
          rolled_back_to_version: string
          rolled_back_version: string
          triggered_by: string | null
          trust_score_before: number | null
        }
        Insert: {
          calibration_error?: number | null
          created_at?: string | null
          id?: string
          improvement_over_heuristic?: number | null
          rollback_reason: string
          rolled_back_to_version: string
          rolled_back_version: string
          triggered_by?: string | null
          trust_score_before?: number | null
        }
        Update: {
          calibration_error?: number | null
          created_at?: string | null
          id?: string
          improvement_over_heuristic?: number | null
          rollback_reason?: string
          rolled_back_to_version?: string
          rolled_back_version?: string
          triggered_by?: string | null
          trust_score_before?: number | null
        }
        Relationships: []
      }
      node_audit_trail: {
        Row: {
          action: string
          id: string
          ip_address: unknown
          metadata: Json | null
          node_id: string | null
          status: string
          timestamp: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          node_id?: string | null
          status: string
          timestamp?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          node_id?: string | null
          status?: string
          timestamp?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "node_audit_trail_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "node_audit_trail_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "accountability_nodes_public"
            referencedColumns: ["id"]
          },
        ]
      }
      normalized_events: {
        Row: {
          category: string | null
          confidence: number | null
          country_iso3: string | null
          created_at: string
          dedup_key: string
          description: string | null
          ended_at: string | null
          entity_id: string | null
          event_type: string
          freshness_score: number | null
          id: string
          iso3: string | null
          last_verified_at: string | null
          location_entity_id: string | null
          metadata: Json | null
          occurred_at: string | null
          provenance_source: string | null
          provider_name: string
          provider_run_id: string | null
          raw_data: Json | null
          raw_payload_id: string | null
          severity: number | null
          source_name: string | null
          source_url: string | null
          started_at: string | null
          title: string
        }
        Insert: {
          category?: string | null
          confidence?: number | null
          country_iso3?: string | null
          created_at?: string
          dedup_key: string
          description?: string | null
          ended_at?: string | null
          entity_id?: string | null
          event_type: string
          freshness_score?: number | null
          id?: string
          iso3?: string | null
          last_verified_at?: string | null
          location_entity_id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          provenance_source?: string | null
          provider_name: string
          provider_run_id?: string | null
          raw_data?: Json | null
          raw_payload_id?: string | null
          severity?: number | null
          source_name?: string | null
          source_url?: string | null
          started_at?: string | null
          title: string
        }
        Update: {
          category?: string | null
          confidence?: number | null
          country_iso3?: string | null
          created_at?: string
          dedup_key?: string
          description?: string | null
          ended_at?: string | null
          entity_id?: string | null
          event_type?: string
          freshness_score?: number | null
          id?: string
          iso3?: string | null
          last_verified_at?: string | null
          location_entity_id?: string | null
          metadata?: Json | null
          occurred_at?: string | null
          provenance_source?: string | null
          provider_name?: string
          provider_run_id?: string | null
          raw_data?: Json | null
          raw_payload_id?: string | null
          severity?: number | null
          source_name?: string | null
          source_url?: string | null
          started_at?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "normalized_events_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_events_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_events_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_events_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_events_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "normalized_events_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_events_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_events_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_events_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_events_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "normalized_events_provider_run_id_fkey"
            columns: ["provider_run_id"]
            isOneToOne: false
            referencedRelation: "provider_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_events_raw_payload_id_fkey"
            columns: ["raw_payload_id"]
            isOneToOne: false
            referencedRelation: "provider_raw_payloads"
            referencedColumns: ["id"]
          },
        ]
      }
      normalized_metrics: {
        Row: {
          confidence: number | null
          created_at: string
          dedup_key: string
          domain: string
          entity_id: string | null
          freshness_score: number | null
          id: string
          iso3: string | null
          last_verified_at: string | null
          location_entity_id: string | null
          metric_name: string
          period: string
          provenance_observed_at: string | null
          provenance_source: string | null
          provider_name: string
          provider_run_id: string | null
          raw_payload_id: string | null
          related_entity_id: string | null
          unit: string | null
          updated_at: string
          value: number
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          dedup_key: string
          domain: string
          entity_id?: string | null
          freshness_score?: number | null
          id?: string
          iso3?: string | null
          last_verified_at?: string | null
          location_entity_id?: string | null
          metric_name: string
          period: string
          provenance_observed_at?: string | null
          provenance_source?: string | null
          provider_name: string
          provider_run_id?: string | null
          raw_payload_id?: string | null
          related_entity_id?: string | null
          unit?: string | null
          updated_at?: string
          value: number
        }
        Update: {
          confidence?: number | null
          created_at?: string
          dedup_key?: string
          domain?: string
          entity_id?: string | null
          freshness_score?: number | null
          id?: string
          iso3?: string | null
          last_verified_at?: string | null
          location_entity_id?: string | null
          metric_name?: string
          period?: string
          provenance_observed_at?: string | null
          provenance_source?: string | null
          provider_name?: string
          provider_run_id?: string | null
          raw_payload_id?: string | null
          related_entity_id?: string | null
          unit?: string | null
          updated_at?: string
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "normalized_metrics_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "normalized_metrics_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_location_entity_id_fkey"
            columns: ["location_entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "normalized_metrics_provider_run_id_fkey"
            columns: ["provider_run_id"]
            isOneToOne: false
            referencedRelation: "provider_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_raw_payload_id_fkey"
            columns: ["raw_payload_id"]
            isOneToOne: false
            referencedRelation: "provider_raw_payloads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_related_entity_id_fkey"
            columns: ["related_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_related_entity_id_fkey"
            columns: ["related_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_related_entity_id_fkey"
            columns: ["related_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_related_entity_id_fkey"
            columns: ["related_entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "normalized_metrics_related_entity_id_fkey"
            columns: ["related_entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      normalized_metrics_archive: {
        Row: {
          archived_at: string
          domain: string
          id: string
          iso3: string | null
          last_period: string | null
          last_value: number | null
          max_value: number | null
          mean_value: number | null
          metric_name: string
          min_value: number | null
          month: string
          provider_name: string
          sample_count: number
        }
        Insert: {
          archived_at?: string
          domain: string
          id?: string
          iso3?: string | null
          last_period?: string | null
          last_value?: number | null
          max_value?: number | null
          mean_value?: number | null
          metric_name: string
          min_value?: number | null
          month: string
          provider_name: string
          sample_count: number
        }
        Update: {
          archived_at?: string
          domain?: string
          id?: string
          iso3?: string | null
          last_period?: string | null
          last_value?: number | null
          max_value?: number | null
          mean_value?: number | null
          metric_name?: string
          min_value?: number | null
          month?: string
          provider_name?: string
          sample_count?: number
        }
        Relationships: []
      }
      notifications: {
        Row: {
          created_at: string | null
          division: string | null
          id: string
          link: string | null
          message: string
          read: boolean | null
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          division?: string | null
          id?: string
          link?: string | null
          message: string
          read?: boolean | null
          title: string
          type: string
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          division?: string | null
          id?: string
          link?: string | null
          message?: string
          read?: boolean | null
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      objective_tasks: {
        Row: {
          action: string | null
          created_at: string | null
          division: string | null
          function_name: string | null
          id: string
          objective_id: string | null
          output_summary: string | null
          parameters: Json | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          action?: string | null
          created_at?: string | null
          division?: string | null
          function_name?: string | null
          id?: string
          objective_id?: string | null
          output_summary?: string | null
          parameters?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          action?: string | null
          created_at?: string | null
          division?: string | null
          function_name?: string | null
          id?: string
          objective_id?: string | null
          output_summary?: string | null
          parameters?: Json | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "objective_tasks_objective_id_fkey"
            columns: ["objective_id"]
            isOneToOne: false
            referencedRelation: "objectives"
            referencedColumns: ["id"]
          },
        ]
      }
      objectives: {
        Row: {
          ai_plan: Json | null
          ai_summary: string | null
          completed_at: string | null
          created_at: string | null
          id: string
          issued_by: string | null
          objective_text: string
          priority: number | null
          started_at: string | null
          status: string | null
        }
        Insert: {
          ai_plan?: Json | null
          ai_summary?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          issued_by?: string | null
          objective_text: string
          priority?: number | null
          started_at?: string | null
          status?: string | null
        }
        Update: {
          ai_plan?: Json | null
          ai_summary?: string | null
          completed_at?: string | null
          created_at?: string | null
          id?: string
          issued_by?: string | null
          objective_text?: string
          priority?: number | null
          started_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      operational_telemetry: {
        Row: {
          created_at: string
          error_message: string | null
          execution_time_ms: number | null
          function_name: string
          id: string
          items_processed: number | null
          metadata: Json | null
          retry_count: number | null
          status: string
        }
        Insert: {
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          function_name: string
          id?: string
          items_processed?: number | null
          metadata?: Json | null
          retry_count?: number | null
          status?: string
        }
        Update: {
          created_at?: string
          error_message?: string | null
          execution_time_ms?: number | null
          function_name?: string
          id?: string
          items_processed?: number | null
          metadata?: Json | null
          retry_count?: number | null
          status?: string
        }
        Relationships: []
      }
      organization_members: {
        Row: {
          created_at: string | null
          id: string
          org_id: string | null
          role: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          org_id?: string | null
          role?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          org_id?: string | null
          role?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_subscriptions: {
        Row: {
          created_at: string | null
          end_date: string | null
          id: string
          org_id: string | null
          plan_id: string | null
          start_date: string | null
          status: string | null
        }
        Insert: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          org_id?: string | null
          plan_id?: string | null
          start_date?: string | null
          status?: string | null
        }
        Update: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          org_id?: string | null
          plan_id?: string | null
          start_date?: string | null
          status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_subscriptions_plan_id_fkey"
            columns: ["plan_id"]
            isOneToOne: false
            referencedRelation: "subscription_plans"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          api_enabled: boolean | null
          billing_status: string | null
          cancel_at_period_end: boolean | null
          created_at: string | null
          feature_flags: Json | null
          id: string
          max_api_keys: number | null
          monthly_api_quota: number | null
          name: string
          owner_id: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: string | null
          trial_ends_at: string | null
          updated_at: string | null
          white_label_enabled: boolean | null
        }
        Insert: {
          api_enabled?: boolean | null
          billing_status?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          feature_flags?: Json | null
          id?: string
          max_api_keys?: number | null
          monthly_api_quota?: number | null
          name: string
          owner_id?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          white_label_enabled?: boolean | null
        }
        Update: {
          api_enabled?: boolean | null
          billing_status?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          feature_flags?: Json | null
          id?: string
          max_api_keys?: number | null
          monthly_api_quota?: number | null
          name?: string
          owner_id?: string | null
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          tier?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          white_label_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      partner_oracles: {
        Row: {
          api_key_hash: string | null
          created_at: string
          enabled: boolean | null
          endpoint_url: string
          id: string
          last_sync_at: string | null
          metadata: Json | null
          partner_name: string
          response_time_avg_ms: number | null
          success_rate: number | null
          trust_score: number
          updated_at: string
        }
        Insert: {
          api_key_hash?: string | null
          created_at?: string
          enabled?: boolean | null
          endpoint_url: string
          id?: string
          last_sync_at?: string | null
          metadata?: Json | null
          partner_name: string
          response_time_avg_ms?: number | null
          success_rate?: number | null
          trust_score?: number
          updated_at?: string
        }
        Update: {
          api_key_hash?: string | null
          created_at?: string
          enabled?: boolean | null
          endpoint_url?: string
          id?: string
          last_sync_at?: string | null
          metadata?: Json | null
          partner_name?: string
          response_time_avg_ms?: number | null
          success_rate?: number | null
          trust_score?: number
          updated_at?: string
        }
        Relationships: []
      }
      performance_backtests: {
        Row: {
          domain: string
          forecast_bias: number | null
          id: string
          iso3: string
          mae: number
          mape: number | null
          rmse: number
          run_at: string
          stability_score: number
        }
        Insert: {
          domain: string
          forecast_bias?: number | null
          id?: string
          iso3: string
          mae?: number
          mape?: number | null
          rmse?: number
          run_at?: string
          stability_score?: number
        }
        Update: {
          domain?: string
          forecast_bias?: number | null
          id?: string
          iso3?: string
          mae?: number
          mape?: number | null
          rmse?: number
          run_at?: string
          stability_score?: number
        }
        Relationships: []
      }
      pilot_run_actions: {
        Row: {
          action_id: string
          created_at: string
          id: string
          outcome_logged: boolean
          outcome_logged_at: string | null
          pilot_run_id: string
        }
        Insert: {
          action_id: string
          created_at?: string
          id?: string
          outcome_logged?: boolean
          outcome_logged_at?: string | null
          pilot_run_id: string
        }
        Update: {
          action_id?: string
          created_at?: string
          id?: string
          outcome_logged?: boolean
          outcome_logged_at?: string | null
          pilot_run_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pilot_run_actions_pilot_run_id_fkey"
            columns: ["pilot_run_id"]
            isOneToOne: false
            referencedRelation: "controlled_pilot_run_status"
            referencedColumns: ["pilot_run_id"]
          },
          {
            foreignKeyName: "pilot_run_actions_pilot_run_id_fkey"
            columns: ["pilot_run_id"]
            isOneToOne: false
            referencedRelation: "pilot_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_runs: {
        Row: {
          accepted_at: string
          accepted_by: string
          cohort_size: number
          completed_at: string | null
          created_at: string
          id: string
          notes: string | null
          outcomes_logged_count: number
          status: string
          updated_at: string
        }
        Insert: {
          accepted_at?: string
          accepted_by: string
          cohort_size: number
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          outcomes_logged_count?: number
          status?: string
          updated_at?: string
        }
        Update: {
          accepted_at?: string
          accepted_by?: string
          cohort_size?: number
          completed_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          outcomes_logged_count?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      pilot_scaling_overrides: {
        Row: {
          blocked_reason: string | null
          created_at: string
          id: string
          overridden_by: string
          reason: string
          requested_cohort_size: number
          used_at: string | null
        }
        Insert: {
          blocked_reason?: string | null
          created_at?: string
          id?: string
          overridden_by: string
          reason: string
          requested_cohort_size: number
          used_at?: string | null
        }
        Update: {
          blocked_reason?: string | null
          created_at?: string
          id?: string
          overridden_by?: string
          reason?: string
          requested_cohort_size?: number
          used_at?: string | null
        }
        Relationships: []
      }
      pipeline_health: {
        Row: {
          alert_triggered: boolean | null
          avg_duration_ms: number | null
          consecutive_failures: number | null
          created_at: string | null
          id: string
          last_failure_at: string | null
          last_success_at: string | null
          metadata: Json | null
          pipeline_name: string
          staleness_threshold_hours: number | null
          status: string | null
          total_runs: number | null
          total_successes: number | null
          updated_at: string | null
        }
        Insert: {
          alert_triggered?: boolean | null
          avg_duration_ms?: number | null
          consecutive_failures?: number | null
          created_at?: string | null
          id?: string
          last_failure_at?: string | null
          last_success_at?: string | null
          metadata?: Json | null
          pipeline_name: string
          staleness_threshold_hours?: number | null
          status?: string | null
          total_runs?: number | null
          total_successes?: number | null
          updated_at?: string | null
        }
        Update: {
          alert_triggered?: boolean | null
          avg_duration_ms?: number | null
          consecutive_failures?: number | null
          created_at?: string | null
          id?: string
          last_failure_at?: string | null
          last_success_at?: string | null
          metadata?: Json | null
          pipeline_name?: string
          staleness_threshold_hours?: number | null
          status?: string | null
          total_runs?: number | null
          total_successes?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      pipeline_heartbeats: {
        Row: {
          consecutive_failures: number
          created_at: string
          enabled: boolean
          expected_interval_minutes: number
          last_attempt_at: string | null
          last_error: string | null
          last_success_at: string | null
          metadata: Json | null
          pipeline_name: string
          target_function: string | null
          updated_at: string
        }
        Insert: {
          consecutive_failures?: number
          created_at?: string
          enabled?: boolean
          expected_interval_minutes?: number
          last_attempt_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          metadata?: Json | null
          pipeline_name: string
          target_function?: string | null
          updated_at?: string
        }
        Update: {
          consecutive_failures?: number
          created_at?: string
          enabled?: boolean
          expected_interval_minutes?: number
          last_attempt_at?: string | null
          last_error?: string | null
          last_success_at?: string | null
          metadata?: Json | null
          pipeline_name?: string
          target_function?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      planetary_stats_snapshots: {
        Row: {
          canonical_mismatches: number
          coverage_countries: number
          duplicate_rate_pct: number
          entities_total: number
          entity_links: number
          event_links: number
          id: string
          job_offsets: Json
          link_to_metric_pct: number
          metric_links: number
          metrics_country_coverage: number
          metrics_total: number
          provenance_completeness_pct: number
          provenance_pct: number
          provenance_sources: number
          reporting_countries: number
          snapped_at: string
        }
        Insert: {
          canonical_mismatches?: number
          coverage_countries?: number
          duplicate_rate_pct?: number
          entities_total?: number
          entity_links?: number
          event_links?: number
          id?: string
          job_offsets?: Json
          link_to_metric_pct?: number
          metric_links?: number
          metrics_country_coverage?: number
          metrics_total?: number
          provenance_completeness_pct?: number
          provenance_pct?: number
          provenance_sources?: number
          reporting_countries?: number
          snapped_at?: string
        }
        Update: {
          canonical_mismatches?: number
          coverage_countries?: number
          duplicate_rate_pct?: number
          entities_total?: number
          entity_links?: number
          event_links?: number
          id?: string
          job_offsets?: Json
          link_to_metric_pct?: number
          metric_links?: number
          metrics_country_coverage?: number
          metrics_total?: number
          provenance_completeness_pct?: number
          provenance_pct?: number
          provenance_sources?: number
          reporting_countries?: number
          snapped_at?: string
        }
        Relationships: []
      }
      political_events: {
        Row: {
          avg_tone: number | null
          created_at: string
          event_count: number
          event_date: string
          event_type: string
          goldstein_scale: number | null
          id: string
          iso3: string
          raw_payload: Json | null
          source: string
          source_url: string | null
        }
        Insert: {
          avg_tone?: number | null
          created_at?: string
          event_count?: number
          event_date: string
          event_type: string
          goldstein_scale?: number | null
          id?: string
          iso3: string
          raw_payload?: Json | null
          source?: string
          source_url?: string | null
        }
        Update: {
          avg_tone?: number | null
          created_at?: string
          event_count?: number
          event_date?: string
          event_type?: string
          goldstein_scale?: number | null
          id?: string
          iso3?: string
          raw_payload?: Json | null
          source?: string
          source_url?: string | null
        }
        Relationships: []
      }
      political_stability_scores: {
        Row: {
          confidence_score: number | null
          conflict_density: number | null
          created_at: string
          days_to_next_election: number | null
          election_volatility_risk: number | null
          id: string
          iso3: string
          mode: string
          model_version: string
          protest_momentum: number | null
          protest_momentum_tstat: number | null
          raw_metrics: Json | null
          score_date: string
          stability_score: number
          structural_break_flag: boolean | null
          structural_break_pvalue: number | null
          volatility_index: number | null
        }
        Insert: {
          confidence_score?: number | null
          conflict_density?: number | null
          created_at?: string
          days_to_next_election?: number | null
          election_volatility_risk?: number | null
          id?: string
          iso3: string
          mode?: string
          model_version?: string
          protest_momentum?: number | null
          protest_momentum_tstat?: number | null
          raw_metrics?: Json | null
          score_date: string
          stability_score: number
          structural_break_flag?: boolean | null
          structural_break_pvalue?: number | null
          volatility_index?: number | null
        }
        Update: {
          confidence_score?: number | null
          conflict_density?: number | null
          created_at?: string
          days_to_next_election?: number | null
          election_volatility_risk?: number | null
          id?: string
          iso3?: string
          mode?: string
          model_version?: string
          protest_momentum?: number | null
          protest_momentum_tstat?: number | null
          raw_metrics?: Json | null
          score_date?: string
          stability_score?: number
          structural_break_flag?: boolean | null
          structural_break_pvalue?: number | null
          volatility_index?: number | null
        }
        Relationships: []
      }
      population_projection: {
        Row: {
          age_group: string | null
          country: string
          created_at: string | null
          density_per_km2: number | null
          id: string
          iso_code: string
          metadata: Json | null
          population: number | null
          projection_variant: string | null
          sex: string | null
          updated_at: string | null
          urban_percentage: number | null
          year: number
        }
        Insert: {
          age_group?: string | null
          country: string
          created_at?: string | null
          density_per_km2?: number | null
          id?: string
          iso_code: string
          metadata?: Json | null
          population?: number | null
          projection_variant?: string | null
          sex?: string | null
          updated_at?: string | null
          urban_percentage?: number | null
          year: number
        }
        Update: {
          age_group?: string | null
          country?: string
          created_at?: string | null
          density_per_km2?: number | null
          id?: string
          iso_code?: string
          metadata?: Json | null
          population?: number | null
          projection_variant?: string | null
          sex?: string | null
          updated_at?: string | null
          urban_percentage?: number | null
          year?: number
        }
        Relationships: []
      }
      predicted_scores: {
        Row: {
          confidence: number | null
          created_at: string | null
          division: string
          id: string
          iso_code: string
          model_version: string | null
          predicted_date: string
          risk_score: number
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          division: string
          id?: string
          iso_code: string
          model_version?: string | null
          predicted_date: string
          risk_score: number
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          division?: string
          id?: string
          iso_code?: string
          model_version?: string | null
          predicted_date?: string
          risk_score?: number
        }
        Relationships: []
      }
      predictions: {
        Row: {
          confidence: number | null
          country: string
          division: string
          forecast: Json
          id: string
          predicted_at: string | null
          volatility_index: number | null
        }
        Insert: {
          confidence?: number | null
          country: string
          division: string
          forecast: Json
          id?: string
          predicted_at?: string | null
          volatility_index?: number | null
        }
        Update: {
          confidence?: number | null
          country?: string
          division?: string
          forecast?: Json
          id?: string
          predicted_at?: string | null
          volatility_index?: number | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      provider_raw_payloads: {
        Row: {
          fetched_at: string
          id: string
          payload: Json
          payload_hash: string
          provider_run_id: string
          source_record_id: string | null
        }
        Insert: {
          fetched_at?: string
          id?: string
          payload: Json
          payload_hash: string
          provider_run_id: string
          source_record_id?: string | null
        }
        Update: {
          fetched_at?: string
          id?: string
          payload?: Json
          payload_hash?: string
          provider_run_id?: string
          source_record_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_raw_payloads_provider_run_id_fkey"
            columns: ["provider_run_id"]
            isOneToOne: false
            referencedRelation: "provider_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_runs: {
        Row: {
          adapter_version: string | null
          completed_at: string | null
          created_at: string
          duration_ms: number | null
          endpoint: string
          entities_resolved: number | null
          error_count: number | null
          error_summary: string | null
          id: string
          params: Json | null
          provider_name: string
          records_deduplicated: number | null
          records_fetched: number | null
          records_inserted: number | null
          records_normalized: number | null
          records_updated: number | null
          records_written: number | null
          replay_source_run_id: string | null
          run_mode: string | null
          started_at: string
          status: string
        }
        Insert: {
          adapter_version?: string | null
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          endpoint: string
          entities_resolved?: number | null
          error_count?: number | null
          error_summary?: string | null
          id?: string
          params?: Json | null
          provider_name: string
          records_deduplicated?: number | null
          records_fetched?: number | null
          records_inserted?: number | null
          records_normalized?: number | null
          records_updated?: number | null
          records_written?: number | null
          replay_source_run_id?: string | null
          run_mode?: string | null
          started_at?: string
          status?: string
        }
        Update: {
          adapter_version?: string | null
          completed_at?: string | null
          created_at?: string
          duration_ms?: number | null
          endpoint?: string
          entities_resolved?: number | null
          error_count?: number | null
          error_summary?: string | null
          id?: string
          params?: Json | null
          provider_name?: string
          records_deduplicated?: number | null
          records_fetched?: number | null
          records_inserted?: number | null
          records_normalized?: number | null
          records_updated?: number | null
          records_written?: number | null
          replay_source_run_id?: string | null
          run_mode?: string | null
          started_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_runs_replay_source_run_id_fkey"
            columns: ["replay_source_run_id"]
            isOneToOne: false
            referencedRelation: "provider_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      quantivis_sync_cursors: {
        Row: {
          created_at: string
          id: string
          last_row_count: number
          last_run_at: string
          last_synced_at: string
          org_id: string
          surface: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          last_row_count?: number
          last_run_at?: string
          last_synced_at?: string
          org_id: string
          surface: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          last_row_count?: number
          last_run_at?: string
          last_synced_at?: string
          org_id?: string
          surface?: string
          updated_at?: string
        }
        Relationships: []
      }
      quantivis_webhook_queue: {
        Row: {
          attempts: number
          created_at: string
          delivered_at: string | null
          event_type: string
          id: string
          last_error: string | null
          max_attempts: number
          next_retry_at: string
          payload: Json
          status: string
          target_url: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          payload?: Json
          status?: string
          target_url: string
        }
        Update: {
          attempts?: number
          created_at?: string
          delivered_at?: string | null
          event_type?: string
          id?: string
          last_error?: string | null
          max_attempts?: number
          next_retry_at?: string
          payload?: Json
          status?: string
          target_url?: string
        }
        Relationships: []
      }
      query_feedback: {
        Row: {
          data_sources_used: Json | null
          execution_time_ms: number | null
          id: string
          query_text: string
          response_relevance: number | null
          timestamp: string | null
          top_apis: Json
          user_id: string | null
          user_satisfaction: number | null
        }
        Insert: {
          data_sources_used?: Json | null
          execution_time_ms?: number | null
          id?: string
          query_text: string
          response_relevance?: number | null
          timestamp?: string | null
          top_apis: Json
          user_id?: string | null
          user_satisfaction?: number | null
        }
        Update: {
          data_sources_used?: Json | null
          execution_time_ms?: number | null
          id?: string
          query_text?: string
          response_relevance?: number | null
          timestamp?: string | null
          top_apis?: Json
          user_id?: string | null
          user_satisfaction?: number | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          blocked_until: string | null
          endpoint: string
          id: string
          ip_address: unknown
          request_count: number
          user_id: string | null
          window_start: string
        }
        Insert: {
          blocked_until?: string | null
          endpoint: string
          id?: string
          ip_address?: unknown
          request_count?: number
          user_id?: string | null
          window_start?: string
        }
        Update: {
          blocked_until?: string | null
          endpoint?: string
          id?: string
          ip_address?: unknown
          request_count?: number
          user_id?: string | null
          window_start?: string
        }
        Relationships: []
      }
      regional_insights: {
        Row: {
          computed_at: string
          confidence: number | null
          countries_included: string[]
          created_at: string
          domain: string
          id: string
          metadata: Json | null
          metric_key: string
          metric_value: number
          primary_country_iso3: string | null
          region_code: string | null
          region_name: string
          trend: string | null
        }
        Insert: {
          computed_at?: string
          confidence?: number | null
          countries_included?: string[]
          created_at?: string
          domain: string
          id?: string
          metadata?: Json | null
          metric_key: string
          metric_value: number
          primary_country_iso3?: string | null
          region_code?: string | null
          region_name: string
          trend?: string | null
        }
        Update: {
          computed_at?: string
          confidence?: number | null
          countries_included?: string[]
          created_at?: string
          domain?: string
          id?: string
          metadata?: Json | null
          metric_key?: string
          metric_value?: number
          primary_country_iso3?: string | null
          region_code?: string | null
          region_name?: string
          trend?: string | null
        }
        Relationships: []
      }
      revenue_metrics: {
        Row: {
          active_subscriptions: number | null
          arr: number | null
          avg_revenue_per_account: number | null
          churned_subscriptions: number | null
          created_at: string | null
          id: string
          metadata: Json | null
          metric_date: string
          mrr: number | null
          new_subscriptions: number | null
          total_revenue: number | null
        }
        Insert: {
          active_subscriptions?: number | null
          arr?: number | null
          avg_revenue_per_account?: number | null
          churned_subscriptions?: number | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          metric_date: string
          mrr?: number | null
          new_subscriptions?: number | null
          total_revenue?: number | null
        }
        Update: {
          active_subscriptions?: number | null
          arr?: number | null
          avg_revenue_per_account?: number | null
          churned_subscriptions?: number | null
          created_at?: string | null
          id?: string
          metadata?: Json | null
          metric_date?: string
          mrr?: number | null
          new_subscriptions?: number | null
          total_revenue?: number | null
        }
        Relationships: []
      }
      revenue_streams: {
        Row: {
          amount_usd: number
          created_at: string
          division: string
          id: string
          meta: Json | null
          source: string
          timestamp: string
        }
        Insert: {
          amount_usd: number
          created_at?: string
          division: string
          id?: string
          meta?: Json | null
          source: string
          timestamp?: string
        }
        Update: {
          amount_usd?: number
          created_at?: string
          division?: string
          id?: string
          meta?: Json | null
          source?: string
          timestamp?: string
        }
        Relationships: []
      }
      reviewer_routing_rules: {
        Row: {
          created_at: string | null
          criticality_tier: string
          default_reviewer: string
          default_reviewer_role: string
          domain: string
          enabled: boolean | null
          id: string
          max_active_assignments: number | null
        }
        Insert: {
          created_at?: string | null
          criticality_tier?: string
          default_reviewer: string
          default_reviewer_role?: string
          domain: string
          enabled?: boolean | null
          id?: string
          max_active_assignments?: number | null
        }
        Update: {
          created_at?: string | null
          criticality_tier?: string
          default_reviewer?: string
          default_reviewer_role?: string
          domain?: string
          enabled?: boolean | null
          id?: string
          max_active_assignments?: number | null
        }
        Relationships: []
      }
      risk_action_recommendations: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          batch_id: string
          confidence: number | null
          counterfactual_md: string | null
          country_iso3: string
          created_at: string
          dismissal_reason: string | null
          dismissed_at: string | null
          dismissed_by: string | null
          domain: string
          estimated_cost_eur: number | null
          estimated_roi_eur: number | null
          evidence_chain: Json | null
          executed_at: string | null
          executed_by: string | null
          execution_note: string | null
          expected_roi_lower: number | null
          expected_roi_upper: number | null
          first_approver: string | null
          generated_at: string
          id: string
          intervention_title: string
          intervention_type: string
          lifecycle_audit_hash: string | null
          linked_outcome_id: string | null
          outcome_logged_at: string | null
          outcome_logged_by: string | null
          outcome_notes_md: string | null
          rank_position: number | null
          ranking_id: string | null
          rationale_md: string | null
          requires_dual_approval: boolean | null
          responsible_domain: string
          risk_probability: number
          second_approver: string | null
          status: string
          updated_at: string
          urgency_hours: number
          urgency_window: string
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          batch_id: string
          confidence?: number | null
          counterfactual_md?: string | null
          country_iso3: string
          created_at?: string
          dismissal_reason?: string | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          domain: string
          estimated_cost_eur?: number | null
          estimated_roi_eur?: number | null
          evidence_chain?: Json | null
          executed_at?: string | null
          executed_by?: string | null
          execution_note?: string | null
          expected_roi_lower?: number | null
          expected_roi_upper?: number | null
          first_approver?: string | null
          generated_at?: string
          id?: string
          intervention_title: string
          intervention_type: string
          lifecycle_audit_hash?: string | null
          linked_outcome_id?: string | null
          outcome_logged_at?: string | null
          outcome_logged_by?: string | null
          outcome_notes_md?: string | null
          rank_position?: number | null
          ranking_id?: string | null
          rationale_md?: string | null
          requires_dual_approval?: boolean | null
          responsible_domain: string
          risk_probability: number
          second_approver?: string | null
          status?: string
          updated_at?: string
          urgency_hours: number
          urgency_window: string
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          batch_id?: string
          confidence?: number | null
          counterfactual_md?: string | null
          country_iso3?: string
          created_at?: string
          dismissal_reason?: string | null
          dismissed_at?: string | null
          dismissed_by?: string | null
          domain?: string
          estimated_cost_eur?: number | null
          estimated_roi_eur?: number | null
          evidence_chain?: Json | null
          executed_at?: string | null
          executed_by?: string | null
          execution_note?: string | null
          expected_roi_lower?: number | null
          expected_roi_upper?: number | null
          first_approver?: string | null
          generated_at?: string
          id?: string
          intervention_title?: string
          intervention_type?: string
          lifecycle_audit_hash?: string | null
          linked_outcome_id?: string | null
          outcome_logged_at?: string | null
          outcome_logged_by?: string | null
          outcome_notes_md?: string | null
          rank_position?: number | null
          ranking_id?: string | null
          rationale_md?: string | null
          requires_dual_approval?: boolean | null
          responsible_domain?: string
          risk_probability?: number
          second_approver?: string | null
          status?: string
          updated_at?: string
          urgency_hours?: number
          urgency_window?: string
        }
        Relationships: [
          {
            foreignKeyName: "risk_action_recommendations_ranking_id_fkey"
            columns: ["ranking_id"]
            isOneToOne: false
            referencedRelation: "quantivis_risk_predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_action_recommendations_ranking_id_fkey"
            columns: ["ranking_id"]
            isOneToOne: false
            referencedRelation: "risk_ranking_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_action_score_adjustments: {
        Row: {
          adjustment_multiplier: number
          computed_at: string
          created_at: string
          id: string
          intervention_type: string
          quality_score: number
          rationale: string
          sample_size: number
          updated_at: string
        }
        Insert: {
          adjustment_multiplier?: number
          computed_at?: string
          created_at?: string
          id?: string
          intervention_type: string
          quality_score: number
          rationale: string
          sample_size?: number
          updated_at?: string
        }
        Update: {
          adjustment_multiplier?: number
          computed_at?: string
          created_at?: string
          id?: string
          intervention_type?: string
          quality_score?: number
          rationale?: string
          sample_size?: number
          updated_at?: string
        }
        Relationships: []
      }
      risk_ml_predictions: {
        Row: {
          audit_hash: string | null
          baseline_score: number | null
          calibrated_score: number | null
          country_iso3: string
          created_at: string | null
          domain: string
          feature_contributions: Json | null
          feature_snapshot: Json | null
          generated_at: string
          generation_batch_id: string
          horizon_days: number
          id: string
          model_version: string
          prediction_interval_lower: number | null
          prediction_interval_upper: number | null
          raw_score: number | null
          risk_probability: number
        }
        Insert: {
          audit_hash?: string | null
          baseline_score?: number | null
          calibrated_score?: number | null
          country_iso3: string
          created_at?: string | null
          domain: string
          feature_contributions?: Json | null
          feature_snapshot?: Json | null
          generated_at?: string
          generation_batch_id: string
          horizon_days?: number
          id?: string
          model_version: string
          prediction_interval_lower?: number | null
          prediction_interval_upper?: number | null
          raw_score?: number | null
          risk_probability: number
        }
        Update: {
          audit_hash?: string | null
          baseline_score?: number | null
          calibrated_score?: number | null
          country_iso3?: string
          created_at?: string | null
          domain?: string
          feature_contributions?: Json | null
          feature_snapshot?: Json | null
          generated_at?: string
          generation_batch_id?: string
          horizon_days?: number
          id?: string
          model_version?: string
          prediction_interval_lower?: number | null
          prediction_interval_upper?: number | null
          raw_score?: number | null
          risk_probability?: number
        }
        Relationships: []
      }
      risk_prediction_realizations: {
        Row: {
          actual_label: number
          brier_score: number
          chain_hash: string | null
          country_iso3: string
          created_at: string
          delta_performance: number | null
          domain: string
          error: number
          horizon_days: number
          id: string
          performance_index_at_pred: number | null
          performance_index_at_realize: number | null
          predicted_at: string
          predicted_probability: number
          prediction_hash: string | null
          prediction_id: string
          previous_realization_hash: string | null
          realized_at: string
          surprise: boolean
        }
        Insert: {
          actual_label: number
          brier_score: number
          chain_hash?: string | null
          country_iso3: string
          created_at?: string
          delta_performance?: number | null
          domain: string
          error: number
          horizon_days?: number
          id?: string
          performance_index_at_pred?: number | null
          performance_index_at_realize?: number | null
          predicted_at: string
          predicted_probability: number
          prediction_hash?: string | null
          prediction_id: string
          previous_realization_hash?: string | null
          realized_at?: string
          surprise?: boolean
        }
        Update: {
          actual_label?: number
          brier_score?: number
          chain_hash?: string | null
          country_iso3?: string
          created_at?: string
          delta_performance?: number | null
          domain?: string
          error?: number
          horizon_days?: number
          id?: string
          performance_index_at_pred?: number | null
          performance_index_at_realize?: number | null
          predicted_at?: string
          predicted_probability?: number
          prediction_hash?: string | null
          prediction_id?: string
          previous_realization_hash?: string | null
          realized_at?: string
          surprise?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "risk_prediction_realizations_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: true
            referencedRelation: "quantivis_risk_predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_prediction_realizations_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: true
            referencedRelation: "risk_ranking_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_predictions: {
        Row: {
          affected_divisions: string[]
          confidence_level: number | null
          created_at: string | null
          description_md: string
          id: string
          impact_score: number | null
          indicators: Json | null
          mitigation_strategies_md: string | null
          model_version: string | null
          predicted_timeframe: string | null
          prediction_type: string
          probability: number | null
          risk_level: string
          title: string
          updated_at: string | null
        }
        Insert: {
          affected_divisions: string[]
          confidence_level?: number | null
          created_at?: string | null
          description_md: string
          id?: string
          impact_score?: number | null
          indicators?: Json | null
          mitigation_strategies_md?: string | null
          model_version?: string | null
          predicted_timeframe?: string | null
          prediction_type: string
          probability?: number | null
          risk_level: string
          title: string
          updated_at?: string | null
        }
        Update: {
          affected_divisions?: string[]
          confidence_level?: number | null
          created_at?: string | null
          description_md?: string
          id?: string
          impact_score?: number | null
          indicators?: Json | null
          mitigation_strategies_md?: string | null
          model_version?: string | null
          predicted_timeframe?: string | null
          prediction_type?: string
          probability?: number | null
          risk_level?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      risk_propagation_score: {
        Row: {
          computed_at: string | null
          contagion_path: Json | null
          decay_factor: number | null
          domain: string
          generation_batch_id: string
          hop_count: number | null
          id: string
          origin_iso3: string
          propagation_score: number
          target_iso3: string
        }
        Insert: {
          computed_at?: string | null
          contagion_path?: Json | null
          decay_factor?: number | null
          domain: string
          generation_batch_id: string
          hop_count?: number | null
          id?: string
          origin_iso3: string
          propagation_score: number
          target_iso3: string
        }
        Update: {
          computed_at?: string | null
          contagion_path?: Json | null
          decay_factor?: number | null
          domain?: string
          generation_batch_id?: string
          hop_count?: number | null
          id?: string
          origin_iso3?: string
          propagation_score?: number
          target_iso3?: string
        }
        Relationships: []
      }
      risk_ranking_predictions: {
        Row: {
          confidence_lower: number | null
          confidence_upper: number | null
          country_iso3: string
          domain: string
          evidence_count: number | null
          factors: Json
          generated_at: string
          generation_batch_id: string
          horizon_days: number
          id: string
          model_version: string
          proxy_share: number | null
          rank_position: number | null
          risk_probability: number
        }
        Insert: {
          confidence_lower?: number | null
          confidence_upper?: number | null
          country_iso3: string
          domain: string
          evidence_count?: number | null
          factors?: Json
          generated_at?: string
          generation_batch_id?: string
          horizon_days?: number
          id?: string
          model_version?: string
          proxy_share?: number | null
          rank_position?: number | null
          risk_probability: number
        }
        Update: {
          confidence_lower?: number | null
          confidence_upper?: number | null
          country_iso3?: string
          domain?: string
          evidence_count?: number | null
          factors?: Json
          generated_at?: string
          generation_batch_id?: string
          horizon_days?: number
          id?: string
          model_version?: string
          proxy_share?: number | null
          rank_position?: number | null
          risk_probability?: number
        }
        Relationships: []
      }
      risk_scores: {
        Row: {
          components: Json | null
          computed_at: string | null
          country_iso3: string
          domain: string
          generation_batch_id: string | null
          id: string
          score: number
        }
        Insert: {
          components?: Json | null
          computed_at?: string | null
          country_iso3: string
          domain: string
          generation_batch_id?: string | null
          id?: string
          score: number
        }
        Update: {
          components?: Json | null
          computed_at?: string | null
          country_iso3?: string
          domain?: string
          generation_batch_id?: string | null
          id?: string
          score?: number
        }
        Relationships: []
      }
      routing_threshold_config: {
        Row: {
          created_at: string | null
          description: string | null
          enabled: boolean | null
          id: string
          min_confidence: number | null
          min_impact: number | null
          misinfo_penalty: number | null
          multi_source_boost: number | null
          official_boost: number | null
          rule_name: string
          trust_floor: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          min_confidence?: number | null
          min_impact?: number | null
          misinfo_penalty?: number | null
          multi_source_boost?: number | null
          official_boost?: number | null
          rule_name: string
          trust_floor?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          enabled?: boolean | null
          id?: string
          min_confidence?: number | null
          min_impact?: number | null
          misinfo_penalty?: number | null
          multi_source_boost?: number | null
          official_boost?: number | null
          rule_name?: string
          trust_floor?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      satellite_observations: {
        Row: {
          confidence: number | null
          created_at: string | null
          id: string
          iso_code: string | null
          lat: number | null
          layer: string
          lon: number | null
          metadata: Json | null
          related_event: string | null
          source: string
          timestamp: string | null
          value: number | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          id?: string
          iso_code?: string | null
          lat?: number | null
          layer: string
          lon?: number | null
          metadata?: Json | null
          related_event?: string | null
          source: string
          timestamp?: string | null
          value?: number | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          id?: string
          iso_code?: string | null
          lat?: number | null
          layer?: string
          lon?: number | null
          metadata?: Json | null
          related_event?: string | null
          source?: string
          timestamp?: string | null
          value?: number | null
        }
        Relationships: []
      }
      satellite_tiles: {
        Row: {
          built_area_pct: number | null
          center_lat: number
          center_lon: number
          cloud_cover_pct: number | null
          created_at: string | null
          id: string
          ndvi: number | null
          nightlight_radiance: number | null
          observation_date: string
          raw_bands: Json | null
          region_id: string | null
          satellite_source: string | null
          tile_x: number
          tile_y: number
          water_body_pct: number | null
          zoom_level: number
        }
        Insert: {
          built_area_pct?: number | null
          center_lat: number
          center_lon: number
          cloud_cover_pct?: number | null
          created_at?: string | null
          id?: string
          ndvi?: number | null
          nightlight_radiance?: number | null
          observation_date: string
          raw_bands?: Json | null
          region_id?: string | null
          satellite_source?: string | null
          tile_x: number
          tile_y: number
          water_body_pct?: number | null
          zoom_level?: number
        }
        Update: {
          built_area_pct?: number | null
          center_lat?: number
          center_lon?: number
          cloud_cover_pct?: number | null
          created_at?: string | null
          id?: string
          ndvi?: number | null
          nightlight_radiance?: number | null
          observation_date?: string
          raw_bands?: Json | null
          region_id?: string | null
          satellite_source?: string | null
          tile_x?: number
          tile_y?: number
          water_body_pct?: number | null
          zoom_level?: number
        }
        Relationships: [
          {
            foreignKeyName: "satellite_tiles_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "admin_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      sc_allocation_policies: {
        Row: {
          constraints: Json
          created_at: string | null
          description_md: string | null
          enabled: boolean | null
          id: string
          policy_key: string
          updated_at: string | null
          weights: Json
        }
        Insert: {
          constraints?: Json
          created_at?: string | null
          description_md?: string | null
          enabled?: boolean | null
          id?: string
          policy_key: string
          updated_at?: string | null
          weights?: Json
        }
        Update: {
          constraints?: Json
          created_at?: string | null
          description_md?: string | null
          enabled?: boolean | null
          id?: string
          policy_key?: string
          updated_at?: string | null
          weights?: Json
        }
        Relationships: []
      }
      sc_oracle_prices: {
        Row: {
          captured_at: string
          confidence: number | null
          id: string
          price_usd: number
          source: string
          symbol: string
          volume_24h: number | null
        }
        Insert: {
          captured_at?: string
          confidence?: number | null
          id?: string
          price_usd: number
          source: string
          symbol: string
          volume_24h?: number | null
        }
        Update: {
          captured_at?: string
          confidence?: number | null
          id?: string
          price_usd?: number
          source?: string
          symbol?: string
          volume_24h?: number | null
        }
        Relationships: []
      }
      sc_rebalance_moves: {
        Row: {
          amount_sc: number | null
          created_at: string | null
          executed: boolean | null
          executed_at: string | null
          from_division: string | null
          id: string
          ledger_tx: Json | null
          reason: string | null
          requires_approval: boolean | null
          run_id: string | null
          to_division: string | null
        }
        Insert: {
          amount_sc?: number | null
          created_at?: string | null
          executed?: boolean | null
          executed_at?: string | null
          from_division?: string | null
          id?: string
          ledger_tx?: Json | null
          reason?: string | null
          requires_approval?: boolean | null
          run_id?: string | null
          to_division?: string | null
        }
        Update: {
          amount_sc?: number | null
          created_at?: string | null
          executed?: boolean | null
          executed_at?: string | null
          from_division?: string | null
          id?: string
          ledger_tx?: Json | null
          reason?: string | null
          requires_approval?: boolean | null
          run_id?: string | null
          to_division?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "sc_rebalance_moves_run_id_fkey"
            columns: ["run_id"]
            isOneToOne: false
            referencedRelation: "sc_rebalance_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      sc_rebalance_runs: {
        Row: {
          created_at: string | null
          created_by: string | null
          finished_at: string | null
          id: string
          mode: string
          notes: string | null
          policy_key: string
          status: string
          total_available_sc: number | null
          total_moved_sc: number | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          finished_at?: string | null
          id?: string
          mode: string
          notes?: string | null
          policy_key: string
          status?: string
          total_available_sc?: number | null
          total_moved_sc?: number | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          finished_at?: string | null
          id?: string
          mode?: string
          notes?: string | null
          policy_key?: string
          status?: string
          total_available_sc?: number | null
          total_moved_sc?: number | null
        }
        Relationships: []
      }
      sdg_mappings: {
        Row: {
          created_at: string | null
          division_key: string
          id: string
          indicator: string
          metric_source: string
          sdg_goal: number
          sdg_target: string
        }
        Insert: {
          created_at?: string | null
          division_key: string
          id?: string
          indicator: string
          metric_source: string
          sdg_goal: number
          sdg_target: string
        }
        Update: {
          created_at?: string | null
          division_key?: string
          id?: string
          indicator?: string
          metric_source?: string
          sdg_goal?: number
          sdg_target?: string
        }
        Relationships: []
      }
      sdg_progress: {
        Row: {
          current_value: number | null
          goal: number
          id: string
          progress_percent: number | null
          target: string
          updated_at: string | null
        }
        Insert: {
          current_value?: number | null
          goal: number
          id?: string
          progress_percent?: number | null
          target: string
          updated_at?: string | null
        }
        Update: {
          current_value?: number | null
          goal?: number
          id?: string
          progress_percent?: number | null
          target?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      security_events: {
        Row: {
          affected_systems: Json | null
          created_at: string | null
          cve_id: string | null
          description: string | null
          detected_at: string | null
          event_type: string
          id: string
          ip_address: unknown
          metadata: Json | null
          severity: string
          source: string
          threat_score: number | null
          title: string
        }
        Insert: {
          affected_systems?: Json | null
          created_at?: string | null
          cve_id?: string | null
          description?: string | null
          detected_at?: string | null
          event_type: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          severity: string
          source: string
          threat_score?: number | null
          title: string
        }
        Update: {
          affected_systems?: Json | null
          created_at?: string | null
          cve_id?: string | null
          description?: string | null
          detected_at?: string | null
          event_type?: string
          id?: string
          ip_address?: unknown
          metadata?: Json | null
          severity?: string
          source?: string
          threat_score?: number | null
          title?: string
        }
        Relationships: []
      }
      security_incidents: {
        Row: {
          admin1: string | null
          admin2: string | null
          country: string | null
          created_at: string | null
          dedupe_key: string | null
          displaced: number | null
          end_time: string | null
          event_type: string | null
          id: string
          injured: number | null
          iso2: string | null
          iso3: string | null
          killed: number | null
          lat: number | null
          lon: number | null
          raw: Json | null
          severity: number | null
          source: string
          source_id: string | null
          start_time: string | null
          summary: string | null
          title: string
          url: string | null
        }
        Insert: {
          admin1?: string | null
          admin2?: string | null
          country?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          displaced?: number | null
          end_time?: string | null
          event_type?: string | null
          id?: string
          injured?: number | null
          iso2?: string | null
          iso3?: string | null
          killed?: number | null
          lat?: number | null
          lon?: number | null
          raw?: Json | null
          severity?: number | null
          source: string
          source_id?: string | null
          start_time?: string | null
          summary?: string | null
          title: string
          url?: string | null
        }
        Update: {
          admin1?: string | null
          admin2?: string | null
          country?: string | null
          created_at?: string | null
          dedupe_key?: string | null
          displaced?: number | null
          end_time?: string | null
          event_type?: string | null
          id?: string
          injured?: number | null
          iso2?: string | null
          iso3?: string | null
          killed?: number | null
          lat?: number | null
          lon?: number | null
          raw?: Json | null
          severity?: number | null
          source?: string
          source_id?: string | null
          start_time?: string | null
          summary?: string | null
          title?: string
          url?: string | null
        }
        Relationships: []
      }
      security_vulnerabilities: {
        Row: {
          affected_products: string[] | null
          created_at: string | null
          cve_id: string
          cvss_score: number | null
          description: string | null
          id: string
          last_modified: string | null
          published_date: string | null
          reference_links: Json | null
          severity: string
          updated_at: string | null
        }
        Insert: {
          affected_products?: string[] | null
          created_at?: string | null
          cve_id: string
          cvss_score?: number | null
          description?: string | null
          id?: string
          last_modified?: string | null
          published_date?: string | null
          reference_links?: Json | null
          severity: string
          updated_at?: string | null
        }
        Update: {
          affected_products?: string[] | null
          created_at?: string | null
          cve_id?: string
          cvss_score?: number | null
          description?: string | null
          id?: string
          last_modified?: string | null
          published_date?: string | null
          reference_links?: Json | null
          severity?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      siem_forward_config: {
        Row: {
          auth_header: string | null
          created_at: string
          destination: string
          enabled: boolean
          endpoint_url: string
          filter_event_types: string[] | null
          id: string
          min_severity: string
          updated_at: string
        }
        Insert: {
          auth_header?: string | null
          created_at?: string
          destination: string
          enabled?: boolean
          endpoint_url: string
          filter_event_types?: string[] | null
          id?: string
          min_severity?: string
          updated_at?: string
        }
        Update: {
          auth_header?: string | null
          created_at?: string
          destination?: string
          enabled?: boolean
          endpoint_url?: string
          filter_event_types?: string[] | null
          id?: string
          min_severity?: string
          updated_at?: string
        }
        Relationships: []
      }
      siem_forward_queue: {
        Row: {
          created_at: string
          event_type: string
          forward_attempts: number
          forwarded: boolean
          forwarded_at: string | null
          id: string
          last_error: string | null
          payload: Json
          severity: string
          source_id: string | null
          source_table: string | null
        }
        Insert: {
          created_at?: string
          event_type: string
          forward_attempts?: number
          forwarded?: boolean
          forwarded_at?: string | null
          id?: string
          last_error?: string | null
          payload: Json
          severity?: string
          source_id?: string | null
          source_table?: string | null
        }
        Update: {
          created_at?: string
          event_type?: string
          forward_attempts?: number
          forwarded?: boolean
          forwarded_at?: string | null
          id?: string
          last_error?: string | null
          payload?: Json
          severity?: string
          source_id?: string | null
          source_table?: string | null
        }
        Relationships: []
      }
      signal_audit_chain: {
        Row: {
          data_sources: Json | null
          domain: string | null
          generated_at: string
          id: string
          input_hash: string | null
          iso3: string | null
          model_version: string | null
          notes: string | null
          output_hash: string | null
          parameters: Json | null
          reproducible: boolean | null
          signal_id: string
          signal_type: string
        }
        Insert: {
          data_sources?: Json | null
          domain?: string | null
          generated_at?: string
          id?: string
          input_hash?: string | null
          iso3?: string | null
          model_version?: string | null
          notes?: string | null
          output_hash?: string | null
          parameters?: Json | null
          reproducible?: boolean | null
          signal_id: string
          signal_type: string
        }
        Update: {
          data_sources?: Json | null
          domain?: string | null
          generated_at?: string
          id?: string
          input_hash?: string | null
          iso3?: string | null
          model_version?: string | null
          notes?: string | null
          output_hash?: string | null
          parameters?: Json | null
          reproducible?: boolean | null
          signal_id?: string
          signal_type?: string
        }
        Relationships: []
      }
      signal_feedback: {
        Row: {
          category: string | null
          comment: string | null
          created_at: string
          decision_id: string | null
          feedback_type: string
          id: string
          rating: number | null
          signal_id: string | null
          source_tier: string | null
          user_id: string
        }
        Insert: {
          category?: string | null
          comment?: string | null
          created_at?: string
          decision_id?: string | null
          feedback_type?: string
          id?: string
          rating?: number | null
          signal_id?: string | null
          source_tier?: string | null
          user_id: string
        }
        Update: {
          category?: string | null
          comment?: string | null
          created_at?: string
          decision_id?: string | null
          feedback_type?: string
          id?: string
          rating?: number | null
          signal_id?: string | null
          source_tier?: string | null
          user_id?: string
        }
        Relationships: []
      }
      signal_quality_metrics_daily: {
        Row: {
          avg_confidence_of_routed: number | null
          avg_impact_of_routed: number | null
          confirm_rate: number | null
          confirmed_count: number | null
          created_at: string | null
          id: string
          metric_date: string
          official_source_pct: number | null
          precision_by_category: Json | null
          precision_by_tier: Json | null
          reject_rate: number | null
          rejected_count: number | null
          tier1_pct: number | null
          tier2_pct: number | null
          tier3_pct: number | null
          total_routed: number | null
          unclear_count: number | null
          unclear_rate: number | null
        }
        Insert: {
          avg_confidence_of_routed?: number | null
          avg_impact_of_routed?: number | null
          confirm_rate?: number | null
          confirmed_count?: number | null
          created_at?: string | null
          id?: string
          metric_date?: string
          official_source_pct?: number | null
          precision_by_category?: Json | null
          precision_by_tier?: Json | null
          reject_rate?: number | null
          rejected_count?: number | null
          tier1_pct?: number | null
          tier2_pct?: number | null
          tier3_pct?: number | null
          total_routed?: number | null
          unclear_count?: number | null
          unclear_rate?: number | null
        }
        Update: {
          avg_confidence_of_routed?: number | null
          avg_impact_of_routed?: number | null
          confirm_rate?: number | null
          confirmed_count?: number | null
          created_at?: string | null
          id?: string
          metric_date?: string
          official_source_pct?: number | null
          precision_by_category?: Json | null
          precision_by_tier?: Json | null
          reject_rate?: number | null
          rejected_count?: number | null
          tier1_pct?: number | null
          tier2_pct?: number | null
          tier3_pct?: number | null
          total_routed?: number | null
          unclear_count?: number | null
          unclear_rate?: number | null
        }
        Relationships: []
      }
      signal_routing_feedback: {
        Row: {
          category_correct: boolean | null
          created_at: string
          feedback: string
          id: string
          impact_appropriate: boolean | null
          reviewed_by: string | null
          reviewer_notes: string | null
          routing_appropriate: boolean | null
          signal_id: string
        }
        Insert: {
          category_correct?: boolean | null
          created_at?: string
          feedback?: string
          id?: string
          impact_appropriate?: boolean | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          routing_appropriate?: boolean | null
          signal_id: string
        }
        Update: {
          category_correct?: boolean | null
          created_at?: string
          feedback?: string
          id?: string
          impact_appropriate?: boolean | null
          reviewed_by?: string | null
          reviewer_notes?: string | null
          routing_appropriate?: boolean | null
          signal_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "signal_routing_feedback_signal_id_fkey"
            columns: ["signal_id"]
            isOneToOne: false
            referencedRelation: "global_signals"
            referencedColumns: ["id"]
          },
        ]
      }
      signal_truth_scores: {
        Row: {
          country_mapping_accuracy: number | null
          created_at: string | null
          domain: string | null
          evidence: Json | null
          id: string
          iso3: string | null
          overall_truth_score: number | null
          precision_score: number | null
          recall_score: number | null
          semantic_validity: number | null
          signal_id: string
          signal_type: string
        }
        Insert: {
          country_mapping_accuracy?: number | null
          created_at?: string | null
          domain?: string | null
          evidence?: Json | null
          id?: string
          iso3?: string | null
          overall_truth_score?: number | null
          precision_score?: number | null
          recall_score?: number | null
          semantic_validity?: number | null
          signal_id: string
          signal_type: string
        }
        Update: {
          country_mapping_accuracy?: number | null
          created_at?: string | null
          domain?: string | null
          evidence?: Json | null
          id?: string
          iso3?: string | null
          overall_truth_score?: number | null
          precision_score?: number | null
          recall_score?: number | null
          semantic_validity?: number | null
          signal_id?: string
          signal_type?: string
        }
        Relationships: []
      }
      silent_failure_state: {
        Row: {
          description: string
          detected_at: string | null
          failure_type: string
          id: string
          metadata: Json | null
          resolved: boolean | null
          resolved_at: string | null
          severity: string | null
        }
        Insert: {
          description: string
          detected_at?: string | null
          failure_type: string
          id?: string
          metadata?: Json | null
          resolved?: boolean | null
          resolved_at?: string | null
          severity?: string | null
        }
        Update: {
          description?: string
          detected_at?: string | null
          failure_type?: string
          id?: string
          metadata?: Json | null
          resolved?: boolean | null
          resolved_at?: string | null
          severity?: string | null
        }
        Relationships: []
      }
      simulation_iterations: {
        Row: {
          affected_count: number | null
          created_at: string | null
          global_impact: number
          id: string
          iteration_index: number
          per_country: Json | null
          simulation_id: string | null
        }
        Insert: {
          affected_count?: number | null
          created_at?: string | null
          global_impact: number
          id?: string
          iteration_index: number
          per_country?: Json | null
          simulation_id?: string | null
        }
        Update: {
          affected_count?: number | null
          created_at?: string | null
          global_impact?: number
          id?: string
          iteration_index?: number
          per_country?: Json | null
          simulation_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "simulation_iterations_simulation_id_fkey"
            columns: ["simulation_id"]
            isOneToOne: false
            referencedRelation: "simulation_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      simulation_runs: {
        Row: {
          affected_countries: Json | null
          baseline_snapshot: Json | null
          cascade_depth: number | null
          cascade_results: Json | null
          confidence: number | null
          created_at: string | null
          created_by: string | null
          estimated_global_impact: number | null
          id: string
          n_iterations: number | null
          p10: number | null
          p50: number | null
          p90: number | null
          result_distribution: Json | null
          scenario_name: string
          scenario_type: string
          seed: number | null
          shock_direction: string
          shock_domain: string
          shock_input: Json | null
          shock_iso3: string | null
          shock_magnitude: number
        }
        Insert: {
          affected_countries?: Json | null
          baseline_snapshot?: Json | null
          cascade_depth?: number | null
          cascade_results?: Json | null
          confidence?: number | null
          created_at?: string | null
          created_by?: string | null
          estimated_global_impact?: number | null
          id?: string
          n_iterations?: number | null
          p10?: number | null
          p50?: number | null
          p90?: number | null
          result_distribution?: Json | null
          scenario_name: string
          scenario_type?: string
          seed?: number | null
          shock_direction?: string
          shock_domain: string
          shock_input?: Json | null
          shock_iso3?: string | null
          shock_magnitude: number
        }
        Update: {
          affected_countries?: Json | null
          baseline_snapshot?: Json | null
          cascade_depth?: number | null
          cascade_results?: Json | null
          confidence?: number | null
          created_at?: string | null
          created_by?: string | null
          estimated_global_impact?: number | null
          id?: string
          n_iterations?: number | null
          p10?: number | null
          p50?: number | null
          p90?: number | null
          result_distribution?: Json | null
          scenario_name?: string
          scenario_type?: string
          seed?: number | null
          shock_direction?: string
          shock_domain?: string
          shock_input?: Json | null
          shock_iso3?: string | null
          shock_magnitude?: number
        }
        Relationships: []
      }
      sla_definitions: {
        Row: {
          alert_channel: string | null
          created_at: string | null
          id: string
          max_consecutive_failures: number
          max_stale_hours: number
          pipeline_name: string
          slo_response_minutes: number | null
          target_uptime_pct: number
          updated_at: string | null
        }
        Insert: {
          alert_channel?: string | null
          created_at?: string | null
          id?: string
          max_consecutive_failures?: number
          max_stale_hours?: number
          pipeline_name: string
          slo_response_minutes?: number | null
          target_uptime_pct?: number
          updated_at?: string | null
        }
        Update: {
          alert_channel?: string | null
          created_at?: string | null
          id?: string
          max_consecutive_failures?: number
          max_stale_hours?: number
          pipeline_name?: string
          slo_response_minutes?: number | null
          target_uptime_pct?: number
          updated_at?: string | null
        }
        Relationships: []
      }
      slo_violations: {
        Row: {
          actual_value: number | null
          auto_remediated: boolean | null
          created_at: string
          expected_value: number | null
          id: string
          pipeline_name: string
          remediation_action: string | null
          resolved_at: string | null
          severity: string
          violation_type: string
        }
        Insert: {
          actual_value?: number | null
          auto_remediated?: boolean | null
          created_at?: string
          expected_value?: number | null
          id?: string
          pipeline_name: string
          remediation_action?: string | null
          resolved_at?: string | null
          severity?: string
          violation_type: string
        }
        Update: {
          actual_value?: number | null
          auto_remediated?: boolean | null
          created_at?: string
          expected_value?: number | null
          id?: string
          pipeline_name?: string
          remediation_action?: string | null
          resolved_at?: string | null
          severity?: string
          violation_type?: string
        }
        Relationships: []
      }
      source_connector_runs: {
        Row: {
          duration_ms: number | null
          error_message: string | null
          id: string
          run_at: string | null
          run_status: string
          signals_fetched: number | null
          signals_merged: number | null
          signals_new: number | null
          source_name: string
          source_type: string | null
        }
        Insert: {
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          run_at?: string | null
          run_status?: string
          signals_fetched?: number | null
          signals_merged?: number | null
          signals_new?: number | null
          source_name: string
          source_type?: string | null
        }
        Update: {
          duration_ms?: number | null
          error_message?: string | null
          id?: string
          run_at?: string | null
          run_status?: string
          signals_fetched?: number | null
          signals_merged?: number | null
          signals_new?: number | null
          source_name?: string
          source_type?: string | null
        }
        Relationships: []
      }
      source_trust_scores: {
        Row: {
          country_jurisdiction: string | null
          created_at: string
          credibility_weight: number
          id: string
          notes: string | null
          official_source: boolean | null
          source_name: string
          source_type: string
          updated_at: string
          verification_level: string
        }
        Insert: {
          country_jurisdiction?: string | null
          created_at?: string
          credibility_weight?: number
          id?: string
          notes?: string | null
          official_source?: boolean | null
          source_name: string
          source_type?: string
          updated_at?: string
          verification_level?: string
        }
        Update: {
          country_jurisdiction?: string | null
          created_at?: string
          credibility_weight?: number
          id?: string
          notes?: string | null
          official_source?: boolean | null
          source_name?: string
          source_type?: string
          updated_at?: string
          verification_level?: string
        }
        Relationships: []
      }
      spc_control_observations: {
        Row: {
          ewma_value: number | null
          id: string
          lower_control: number | null
          metric_name: string
          model_version: string
          observed_at: string
          observed_value: number
          out_of_control: boolean | null
          rolling_mean: number | null
          rolling_std: number | null
          upper_control: number | null
        }
        Insert: {
          ewma_value?: number | null
          id?: string
          lower_control?: number | null
          metric_name: string
          model_version?: string
          observed_at?: string
          observed_value: number
          out_of_control?: boolean | null
          rolling_mean?: number | null
          rolling_std?: number | null
          upper_control?: number | null
        }
        Update: {
          ewma_value?: number | null
          id?: string
          lower_control?: number | null
          metric_name?: string
          model_version?: string
          observed_at?: string
          observed_value?: number
          out_of_control?: boolean | null
          rolling_mean?: number | null
          rolling_std?: number | null
          upper_control?: number | null
        }
        Relationships: []
      }
      status_incidents: {
        Row: {
          affected_components: string[]
          created_at: string
          description: string | null
          id: string
          impact: string
          resolved_at: string | null
          started_at: string
          status: string
          title: string
          updated_at: string
          updates: Json
        }
        Insert: {
          affected_components?: string[]
          created_at?: string
          description?: string | null
          id?: string
          impact?: string
          resolved_at?: string | null
          started_at?: string
          status?: string
          title: string
          updated_at?: string
          updates?: Json
        }
        Update: {
          affected_components?: string[]
          created_at?: string
          description?: string | null
          id?: string
          impact?: string
          resolved_at?: string | null
          started_at?: string
          status?: string
          title?: string
          updated_at?: string
          updates?: Json
        }
        Relationships: []
      }
      status_uptime_daily: {
        Row: {
          avg_response_ms: number | null
          component: string
          created_at: string
          day: string
          degraded_checks: number
          down_checks: number
          healthy_checks: number
          id: string
          total_checks: number
          uptime_pct: number
        }
        Insert: {
          avg_response_ms?: number | null
          component: string
          created_at?: string
          day: string
          degraded_checks?: number
          down_checks?: number
          healthy_checks?: number
          id?: string
          total_checks?: number
          uptime_pct?: number
        }
        Update: {
          avg_response_ms?: number | null
          component?: string
          created_at?: string
          day?: string
          degraded_checks?: number
          down_checks?: number
          healthy_checks?: number
          id?: string
          total_checks?: number
          uptime_pct?: number
        }
        Relationships: []
      }
      subnational_inference_runs: {
        Row: {
          admin_level: number | null
          country_iso3: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          finished_at: string | null
          function_name: string
          metadata: Json | null
          rows_attempted: number | null
          rows_written: number
          run_id: string
          started_at: string
          status: string
        }
        Insert: {
          admin_level?: number | null
          country_iso3?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          function_name: string
          metadata?: Json | null
          rows_attempted?: number | null
          rows_written?: number
          run_id?: string
          started_at?: string
          status?: string
        }
        Update: {
          admin_level?: number | null
          country_iso3?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          finished_at?: string | null
          function_name?: string
          metadata?: Json | null
          rows_attempted?: number | null
          rows_written?: number
          run_id?: string
          started_at?: string
          status?: string
        }
        Relationships: []
      }
      subscription_plans: {
        Row: {
          billing_cycle: string | null
          created_at: string | null
          features: Json
          id: string
          key: string
          name: string
          price_usd: number
        }
        Insert: {
          billing_cycle?: string | null
          created_at?: string | null
          features: Json
          id?: string
          key: string
          name: string
          price_usd: number
        }
        Update: {
          billing_cycle?: string | null
          created_at?: string | null
          features?: Json
          id?: string
          key?: string
          name?: string
          price_usd?: number
        }
        Relationships: []
      }
      subscription_tiers: {
        Row: {
          created_at: string
          features: Json | null
          id: string
          is_active: boolean | null
          max_decisions_per_month: number | null
          max_domains: number | null
          name: string
          price_monthly: number
          stripe_price_id: string | null
        }
        Insert: {
          created_at?: string
          features?: Json | null
          id?: string
          is_active?: boolean | null
          max_decisions_per_month?: number | null
          max_domains?: number | null
          name: string
          price_monthly?: number
          stripe_price_id?: string | null
        }
        Update: {
          created_at?: string
          features?: Json | null
          id?: string
          is_active?: boolean | null
          max_decisions_per_month?: number | null
          max_domains?: number | null
          name?: string
          price_monthly?: number
          stripe_price_id?: string | null
        }
        Relationships: []
      }
      system_config: {
        Row: {
          created_at: string | null
          description: string | null
          key: string
          updated_at: string | null
          value: Json
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          key: string
          updated_at?: string | null
          value: Json
        }
        Update: {
          created_at?: string | null
          description?: string | null
          key?: string
          updated_at?: string | null
          value?: Json
        }
        Relationships: []
      }
      system_errors: {
        Row: {
          component: string
          created_at: string | null
          details: Json | null
          id: string
          message: string
        }
        Insert: {
          component: string
          created_at?: string | null
          details?: Json | null
          id?: string
          message: string
        }
        Update: {
          component?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          message?: string
        }
        Relationships: []
      }
      system_flags: {
        Row: {
          description: string | null
          enabled: boolean
          flag_key: string
          id: string
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          description?: string | null
          enabled?: boolean
          flag_key: string
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          description?: string | null
          enabled?: boolean
          flag_key?: string
          id?: string
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: []
      }
      system_health: {
        Row: {
          checked_at: string
          component: string
          error_message: string | null
          id: string
          metadata: Json | null
          response_time_ms: number | null
          status: string
        }
        Insert: {
          checked_at?: string
          component: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          response_time_ms?: number | null
          status: string
        }
        Update: {
          checked_at?: string
          component?: string
          error_message?: string | null
          id?: string
          metadata?: Json | null
          response_time_ms?: number | null
          status?: string
        }
        Relationships: []
      }
      system_logs: {
        Row: {
          action: string
          created_at: string
          division: string | null
          id: string
          log_level: Database["public"]["Enums"]["log_level"]
          metadata: Json | null
          result: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          division?: string | null
          id?: string
          log_level?: Database["public"]["Enums"]["log_level"]
          metadata?: Json | null
          result?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          division?: string | null
          id?: string
          log_level?: Database["public"]["Enums"]["log_level"]
          metadata?: Json | null
          result?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      system_service_catalog: {
        Row: {
          created_at: string
          criticality: string
          description: string | null
          enabled: boolean
          id: string
          kind: string
          name: string
          owner: string | null
          schedule: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          criticality?: string
          description?: string | null
          enabled?: boolean
          id?: string
          kind: string
          name: string
          owner?: string | null
          schedule?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          criticality?: string
          description?: string | null
          enabled?: boolean
          id?: string
          kind?: string
          name?: string
          owner?: string | null
          schedule?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      tenant_action_log: {
        Row: {
          action: string
          created_at: string | null
          details: Json | null
          id: string
          ip_address: unknown
          org_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          org_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          details?: Json | null
          id?: string
          ip_address?: unknown
          org_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_action_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_action_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_action_log_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_metrics: {
        Row: {
          active_users_count: number | null
          api_requests_count: number | null
          avg_response_time_ms: number | null
          cost_estimate_usd: number | null
          database_queries_count: number | null
          edge_function_invocations: number | null
          error_count: number | null
          id: string
          metric_date: string
          org_id: string
          storage_used_bytes: number | null
        }
        Insert: {
          active_users_count?: number | null
          api_requests_count?: number | null
          avg_response_time_ms?: number | null
          cost_estimate_usd?: number | null
          database_queries_count?: number | null
          edge_function_invocations?: number | null
          error_count?: number | null
          id?: string
          metric_date?: string
          org_id: string
          storage_used_bytes?: number | null
        }
        Update: {
          active_users_count?: number | null
          api_requests_count?: number | null
          avg_response_time_ms?: number | null
          cost_estimate_usd?: number | null
          database_queries_count?: number | null
          edge_function_invocations?: number | null
          error_count?: number | null
          id?: string
          metric_date?: string
          org_id?: string
          storage_used_bytes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_metrics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_metrics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_metrics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_onboarding: {
        Row: {
          branding_complete: boolean | null
          completed: boolean | null
          completed_at: string | null
          created_at: string | null
          domain_complete: boolean | null
          id: string
          org_id: string
          plan_complete: boolean | null
          profile_complete: boolean | null
          step: string
          updated_at: string | null
        }
        Insert: {
          branding_complete?: boolean | null
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          domain_complete?: boolean | null
          id?: string
          org_id: string
          plan_complete?: boolean | null
          profile_complete?: boolean | null
          step?: string
          updated_at?: string | null
        }
        Update: {
          branding_complete?: boolean | null
          completed?: boolean | null
          completed_at?: string | null
          created_at?: string | null
          domain_complete?: boolean | null
          id?: string
          org_id?: string
          plan_complete?: boolean | null
          profile_complete?: boolean | null
          step?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "tenant_onboarding_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_onboarding_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "tenant_onboarding_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      threat_logs: {
        Row: {
          created_at: string
          description: string | null
          id: string
          location: string | null
          neutralized: boolean
          resolved_at: string | null
          response_time_ms: number | null
          severity: Database["public"]["Enums"]["threat_severity"]
          threat_type: Database["public"]["Enums"]["threat_type"]
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          location?: string | null
          neutralized?: boolean
          resolved_at?: string | null
          response_time_ms?: number | null
          severity: Database["public"]["Enums"]["threat_severity"]
          threat_type: Database["public"]["Enums"]["threat_type"]
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          location?: string | null
          neutralized?: boolean
          resolved_at?: string | null
          response_time_ms?: number | null
          severity?: Database["public"]["Enums"]["threat_severity"]
          threat_type?: Database["public"]["Enums"]["threat_type"]
        }
        Relationships: []
      }
      trades: {
        Row: {
          amount: number
          created_at: string
          exchange: string
          executed_at: string | null
          id: string
          pair: string
          price: number
          profit: number | null
          side: Database["public"]["Enums"]["trade_side"]
          status: Database["public"]["Enums"]["trade_status"]
        }
        Insert: {
          amount: number
          created_at?: string
          exchange: string
          executed_at?: string | null
          id?: string
          pair: string
          price: number
          profit?: number | null
          side: Database["public"]["Enums"]["trade_side"]
          status?: Database["public"]["Enums"]["trade_status"]
        }
        Update: {
          amount?: number
          created_at?: string
          exchange?: string
          executed_at?: string | null
          id?: string
          pair?: string
          price?: number
          profit?: number | null
          side?: Database["public"]["Enums"]["trade_side"]
          status?: Database["public"]["Enums"]["trade_status"]
        }
        Relationships: []
      }
      training_dataset_aicis: {
        Row: {
          built_at: string
          country_iso3: string
          cross_domain_pressure: number | null
          data_density_score: number | null
          dataset_split: string
          domain: string
          event_severity_avg_7d: number | null
          event_severity_max_7d: number | null
          event_velocity: number | null
          events_count_30d: number | null
          events_count_7d: number | null
          feature_hash: string | null
          feature_version: string | null
          forecast_confidence_avg: number | null
          freshness_score: number | null
          horizon_days: number
          id: string
          is_leakage_safe: boolean | null
          is_real_data: boolean
          label_did_deteriorate: number | null
          label_horizon_end_at: string | null
          label_metric_value_at_horizon: number | null
          label_zscore_at_horizon: number | null
          metric_sample_count_30d: number | null
          metric_trend_30d: number | null
          metric_trend_7d: number | null
          metric_value_t: number | null
          metric_volatility_30d: number | null
          metric_zscore_vs_90d: number | null
          neighbor_risk_score: number | null
          past_forecast_error_30d: number | null
          snapshot_date: string
        }
        Insert: {
          built_at?: string
          country_iso3: string
          cross_domain_pressure?: number | null
          data_density_score?: number | null
          dataset_split?: string
          domain: string
          event_severity_avg_7d?: number | null
          event_severity_max_7d?: number | null
          event_velocity?: number | null
          events_count_30d?: number | null
          events_count_7d?: number | null
          feature_hash?: string | null
          feature_version?: string | null
          forecast_confidence_avg?: number | null
          freshness_score?: number | null
          horizon_days?: number
          id?: string
          is_leakage_safe?: boolean | null
          is_real_data?: boolean
          label_did_deteriorate?: number | null
          label_horizon_end_at?: string | null
          label_metric_value_at_horizon?: number | null
          label_zscore_at_horizon?: number | null
          metric_sample_count_30d?: number | null
          metric_trend_30d?: number | null
          metric_trend_7d?: number | null
          metric_value_t?: number | null
          metric_volatility_30d?: number | null
          metric_zscore_vs_90d?: number | null
          neighbor_risk_score?: number | null
          past_forecast_error_30d?: number | null
          snapshot_date: string
        }
        Update: {
          built_at?: string
          country_iso3?: string
          cross_domain_pressure?: number | null
          data_density_score?: number | null
          dataset_split?: string
          domain?: string
          event_severity_avg_7d?: number | null
          event_severity_max_7d?: number | null
          event_velocity?: number | null
          events_count_30d?: number | null
          events_count_7d?: number | null
          feature_hash?: string | null
          feature_version?: string | null
          forecast_confidence_avg?: number | null
          freshness_score?: number | null
          horizon_days?: number
          id?: string
          is_leakage_safe?: boolean | null
          is_real_data?: boolean
          label_did_deteriorate?: number | null
          label_horizon_end_at?: string | null
          label_metric_value_at_horizon?: number | null
          label_zscore_at_horizon?: number | null
          metric_sample_count_30d?: number | null
          metric_trend_30d?: number | null
          metric_trend_7d?: number | null
          metric_value_t?: number | null
          metric_volatility_30d?: number | null
          metric_zscore_vs_90d?: number | null
          neighbor_risk_score?: number | null
          past_forecast_error_30d?: number | null
          snapshot_date?: string
        }
        Relationships: []
      }
      training_dataset_splits: {
        Row: {
          created_at: string | null
          feature_version: string | null
          fold_index: number
          id: string
          period_end: string
          period_start: string
          split_name: string
          training_row_id: string | null
        }
        Insert: {
          created_at?: string | null
          feature_version?: string | null
          fold_index?: number
          id?: string
          period_end: string
          period_start: string
          split_name: string
          training_row_id?: string | null
        }
        Update: {
          created_at?: string | null
          feature_version?: string | null
          fold_index?: number
          id?: string
          period_end?: string
          period_start?: string
          split_name?: string
          training_row_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "training_dataset_splits_training_row_id_fkey"
            columns: ["training_row_id"]
            isOneToOne: false
            referencedRelation: "training_dataset_aicis"
            referencedColumns: ["id"]
          },
        ]
      }
      transparency_reports: {
        Row: {
          avg_trust_score: number | null
          created_at: string | null
          data_breaches_count: number | null
          ethics_appeals_count: number | null
          gdpr_requests_count: number | null
          id: string
          published_at: string | null
          report_content: string | null
          report_period_end: string
          report_period_start: string
          signed_hash: string | null
          total_decisions: number | null
          total_users: number | null
        }
        Insert: {
          avg_trust_score?: number | null
          created_at?: string | null
          data_breaches_count?: number | null
          ethics_appeals_count?: number | null
          gdpr_requests_count?: number | null
          id?: string
          published_at?: string | null
          report_content?: string | null
          report_period_end: string
          report_period_start: string
          signed_hash?: string | null
          total_decisions?: number | null
          total_users?: number | null
        }
        Update: {
          avg_trust_score?: number | null
          created_at?: string | null
          data_breaches_count?: number | null
          ethics_appeals_count?: number | null
          gdpr_requests_count?: number | null
          id?: string
          published_at?: string | null
          report_content?: string | null
          report_period_end?: string
          report_period_start?: string
          signed_hash?: string | null
          total_decisions?: number | null
          total_users?: number | null
        }
        Relationships: []
      }
      trust_metrics: {
        Row: {
          computed_at: string | null
          id: string
          metadata: Json | null
          metric_type: string
          metric_unit: string | null
          metric_value: number
          signature: string | null
        }
        Insert: {
          computed_at?: string | null
          id?: string
          metadata?: Json | null
          metric_type: string
          metric_unit?: string | null
          metric_value: number
          signature?: string | null
        }
        Update: {
          computed_at?: string | null
          id?: string
          metadata?: Json | null
          metric_type?: string
          metric_unit?: string | null
          metric_value?: number
          signature?: string | null
        }
        Relationships: []
      }
      truth_harness_versions: {
        Row: {
          backfilled_layers: string[] | null
          created_at: string
          frozen_at: string
          id: string
          measurement_fixes: string[] | null
          notes: string | null
          sampling_strategy: Json
          scoring_formula: Json
          structural_fixes: string[] | null
          version_tag: string
        }
        Insert: {
          backfilled_layers?: string[] | null
          created_at?: string
          frozen_at?: string
          id?: string
          measurement_fixes?: string[] | null
          notes?: string | null
          sampling_strategy: Json
          scoring_formula: Json
          structural_fixes?: string[] | null
          version_tag: string
        }
        Update: {
          backfilled_layers?: string[] | null
          created_at?: string
          frozen_at?: string
          id?: string
          measurement_fixes?: string[] | null
          notes?: string | null
          sampling_strategy?: Json
          scoring_formula?: Json
          structural_fixes?: string[] | null
          version_tag?: string
        }
        Relationships: []
      }
      urban_metrics: {
        Row: {
          city_name: string
          computed_at: string
          country_iso3: string
          created_at: string
          domain: string
          id: string
          indicator_key: string
          metadata: Json | null
          region_id: string | null
          source_count: number | null
          unit: string | null
          value: number
        }
        Insert: {
          city_name: string
          computed_at?: string
          country_iso3: string
          created_at?: string
          domain: string
          id?: string
          indicator_key: string
          metadata?: Json | null
          region_id?: string | null
          source_count?: number | null
          unit?: string | null
          value: number
        }
        Update: {
          city_name?: string
          computed_at?: string
          country_iso3?: string
          created_at?: string
          domain?: string
          id?: string
          indicator_key?: string
          metadata?: Json | null
          region_id?: string | null
          source_count?: number | null
          unit?: string | null
          value?: number
        }
        Relationships: [
          {
            foreignKeyName: "urban_metrics_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "admin_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_metrics: {
        Row: {
          created_at: string | null
          id: string
          metric_key: string
          metric_value: number | null
          org_id: string | null
          period_end: string | null
          period_start: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          metric_key: string
          metric_value?: number | null
          org_id?: string | null
          period_end?: string | null
          period_start?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          metric_key?: string
          metric_value?: number | null
          org_id?: string | null
          period_end?: string | null
          period_start?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_metrics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_metrics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_metrics_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      usage_records: {
        Row: {
          billed: boolean | null
          created_at: string | null
          id: string
          metric_key: string
          org_id: string
          period_end: string
          period_start: string
          quantity: number
          stripe_usage_record_id: string | null
          updated_at: string | null
        }
        Insert: {
          billed?: boolean | null
          created_at?: string | null
          id?: string
          metric_key: string
          org_id: string
          period_end: string
          period_start: string
          quantity?: number
          stripe_usage_record_id?: string | null
          updated_at?: string | null
        }
        Update: {
          billed?: boolean | null
          created_at?: string | null
          id?: string
          metric_key?: string
          org_id?: string
          period_end?: string
          period_start?: string
          quantity?: number
          stripe_usage_record_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_records_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      user_consent: {
        Row: {
          accepted_at: string
          created_at: string | null
          id: string
          retention_days: number
          revoked_at: string | null
          user_id: string
          version: string
        }
        Insert: {
          accepted_at?: string
          created_at?: string | null
          id?: string
          retention_days?: number
          revoked_at?: string | null
          user_id: string
          version?: string
        }
        Update: {
          accepted_at?: string
          created_at?: string | null
          id?: string
          retention_days?: number
          revoked_at?: string | null
          user_id?: string
          version?: string
        }
        Relationships: []
      }
      user_notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          metadata: Json | null
          read: boolean
          title: string
          type: string
          user_id: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          read?: boolean
          title: string
          type?: string
          user_id?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          metadata?: Json | null
          read?: boolean
          title?: string
          type?: string
          user_id?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_sessions: {
        Row: {
          created_at: string
          expires_at: string
          id: string
          ip_address: unknown
          last_active_at: string
          revoke_reason: string | null
          revoked_at: string | null
          session_token: string
          user_agent: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          id?: string
          ip_address?: unknown
          last_active_at?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          session_token: string
          user_agent?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          id?: string
          ip_address?: unknown
          last_active_at?: string
          revoke_reason?: string | null
          revoked_at?: string | null
          session_token?: string
          user_agent?: string | null
          user_id?: string
        }
        Relationships: []
      }
      village_indicators: {
        Row: {
          confidence: number | null
          country_iso3: string | null
          created_at: string | null
          data_source: string
          domain: string
          id: string
          indicator: string
          inference_model: string | null
          observed_at: string | null
          raw: Json | null
          region_id: string
          unit: string | null
          value: number | null
        }
        Insert: {
          confidence?: number | null
          country_iso3?: string | null
          created_at?: string | null
          data_source: string
          domain: string
          id?: string
          indicator: string
          inference_model?: string | null
          observed_at?: string | null
          raw?: Json | null
          region_id: string
          unit?: string | null
          value?: number | null
        }
        Update: {
          confidence?: number | null
          country_iso3?: string | null
          created_at?: string | null
          data_source?: string
          domain?: string
          id?: string
          indicator?: string
          inference_model?: string | null
          observed_at?: string | null
          raw?: Json | null
          region_id?: string
          unit?: string | null
          value?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "village_indicators_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "admin_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      village_seed_attempts: {
        Row: {
          attempted_at: string | null
          country_iso3: string
          last_error: string | null
          next_retry_at: string | null
          retry_count: number
          status: string | null
          updated_at: string
          villages_found: number | null
        }
        Insert: {
          attempted_at?: string | null
          country_iso3: string
          last_error?: string | null
          next_retry_at?: string | null
          retry_count?: number
          status?: string | null
          updated_at?: string
          villages_found?: number | null
        }
        Update: {
          attempted_at?: string | null
          country_iso3?: string
          last_error?: string | null
          next_retry_at?: string | null
          retry_count?: number
          status?: string | null
          updated_at?: string
          villages_found?: number | null
        }
        Relationships: []
      }
      vulnerability_event_correlations: {
        Row: {
          country: string
          created_at: string | null
          days_between: number
          event_date: string
          event_id: string | null
          event_severity: number | null
          event_type: string
          id: string
          iso3: string
          signal_strength: number | null
          vulnerability_date: string
          vulnerability_score: number
        }
        Insert: {
          country: string
          created_at?: string | null
          days_between: number
          event_date: string
          event_id?: string | null
          event_severity?: number | null
          event_type: string
          id?: string
          iso3: string
          signal_strength?: number | null
          vulnerability_date: string
          vulnerability_score: number
        }
        Update: {
          country?: string
          created_at?: string | null
          days_between?: number
          event_date?: string
          event_id?: string | null
          event_severity?: number | null
          event_type?: string
          id?: string
          iso3?: string
          signal_strength?: number | null
          vulnerability_date?: string
          vulnerability_score?: number
        }
        Relationships: []
      }
      vulnerability_scores: {
        Row: {
          calculated_at: string | null
          climate_risk: number | null
          confidence: number | null
          country: string
          created_at: string | null
          data_sources: Json | null
          economic_risk: number | null
          energy_risk: number | null
          food_risk: number | null
          governance_risk: number | null
          health_risk: number | null
          id: string
          iso_code: string
          latitude: number | null
          longitude: number | null
          overall_score: number
          population: number | null
        }
        Insert: {
          calculated_at?: string | null
          climate_risk?: number | null
          confidence?: number | null
          country: string
          created_at?: string | null
          data_sources?: Json | null
          economic_risk?: number | null
          energy_risk?: number | null
          food_risk?: number | null
          governance_risk?: number | null
          health_risk?: number | null
          id?: string
          iso_code: string
          latitude?: number | null
          longitude?: number | null
          overall_score: number
          population?: number | null
        }
        Update: {
          calculated_at?: string | null
          climate_risk?: number | null
          confidence?: number | null
          country?: string
          created_at?: string | null
          data_sources?: Json | null
          economic_risk?: number | null
          energy_risk?: number | null
          food_risk?: number | null
          governance_risk?: number | null
          health_risk?: number | null
          id?: string
          iso_code?: string
          latitude?: number | null
          longitude?: number | null
          overall_score?: number
          population?: number | null
        }
        Relationships: []
      }
      watchlist_events: {
        Row: {
          created_at: string
          current_value: number | null
          delta_value: number | null
          event_hash: string | null
          event_summary: string
          event_type: string
          id: string
          metadata: Json | null
          previous_value: number | null
          severity: string
          watchlist_item_id: string
        }
        Insert: {
          created_at?: string
          current_value?: number | null
          delta_value?: number | null
          event_hash?: string | null
          event_summary: string
          event_type: string
          id?: string
          metadata?: Json | null
          previous_value?: number | null
          severity?: string
          watchlist_item_id: string
        }
        Update: {
          created_at?: string
          current_value?: number | null
          delta_value?: number | null
          event_hash?: string | null
          event_summary?: string
          event_type?: string
          id?: string
          metadata?: Json | null
          previous_value?: number | null
          severity?: string
          watchlist_item_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_events_watchlist_item_id_fkey"
            columns: ["watchlist_item_id"]
            isOneToOne: false
            referencedRelation: "watchlist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      watchlist_items: {
        Row: {
          alert_enabled: boolean
          alert_threshold: number | null
          country_iso3: string | null
          created_at: string
          current_status: string
          hotspot_key: string | null
          id: string
          is_active: boolean
          label: string
          last_alerted_at: string | null
          last_checked_at: string | null
          last_risk_value: number | null
          priority_level: string
          region_id: string | null
          updated_at: string
          user_id: string
          watch_type: string
        }
        Insert: {
          alert_enabled?: boolean
          alert_threshold?: number | null
          country_iso3?: string | null
          created_at?: string
          current_status?: string
          hotspot_key?: string | null
          id?: string
          is_active?: boolean
          label: string
          last_alerted_at?: string | null
          last_checked_at?: string | null
          last_risk_value?: number | null
          priority_level?: string
          region_id?: string | null
          updated_at?: string
          user_id: string
          watch_type?: string
        }
        Update: {
          alert_enabled?: boolean
          alert_threshold?: number | null
          country_iso3?: string | null
          created_at?: string
          current_status?: string
          hotspot_key?: string | null
          id?: string
          is_active?: boolean
          label?: string
          last_alerted_at?: string | null
          last_checked_at?: string | null
          last_risk_value?: number | null
          priority_level?: string
          region_id?: string | null
          updated_at?: string
          user_id?: string
          watch_type?: string
        }
        Relationships: [
          {
            foreignKeyName: "watchlist_items_region_id_fkey"
            columns: ["region_id"]
            isOneToOne: false
            referencedRelation: "admin_regions"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_event_log: {
        Row: {
          created_at: string | null
          event_id: string
          event_type: string
          id: string
          payload: Json
          processed: boolean | null
          processed_at: string | null
          processing_error: string | null
          webhook_source: string
        }
        Insert: {
          created_at?: string | null
          event_id: string
          event_type: string
          id?: string
          payload: Json
          processed?: boolean | null
          processed_at?: string | null
          processing_error?: string | null
          webhook_source?: string
        }
        Update: {
          created_at?: string | null
          event_id?: string
          event_type?: string
          id?: string
          payload?: Json
          processed?: boolean | null
          processed_at?: string | null
          processing_error?: string | null
          webhook_source?: string
        }
        Relationships: []
      }
      webhook_subscriptions: {
        Row: {
          active: boolean
          created_at: string
          events: string[]
          failure_count: number
          id: string
          last_delivered_at: string | null
          org_id: string
          secret: string
          updated_at: string
          url: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          events?: string[]
          failure_count?: number
          id?: string
          last_delivered_at?: string | null
          org_id: string
          secret: string
          updated_at?: string
          url: string
        }
        Update: {
          active?: boolean
          created_at?: string
          events?: string[]
          failure_count?: number
          id?: string
          last_delivered_at?: string | null
          org_id?: string
          secret?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_member_view"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_subscriptions_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations_safe_view"
            referencedColumns: ["id"]
          },
        ]
      }
      weekly_briefs: {
        Row: {
          avg_confidence: number | null
          avg_mape: number | null
          brief_date: string
          countries_covered: number
          created_at: string
          generated_at: string
          id: string
          issue_number: number
          metadata: Json | null
          models_count: number
          sections: Json
          summary_md: string
          title: string
        }
        Insert: {
          avg_confidence?: number | null
          avg_mape?: number | null
          brief_date?: string
          countries_covered?: number
          created_at?: string
          generated_at?: string
          id?: string
          issue_number: number
          metadata?: Json | null
          models_count?: number
          sections?: Json
          summary_md: string
          title: string
        }
        Update: {
          avg_confidence?: number | null
          avg_mape?: number | null
          brief_date?: string
          countries_covered?: number
          created_at?: string
          generated_at?: string
          id?: string
          issue_number?: number
          metadata?: Json | null
          models_count?: number
          sections?: Json
          summary_md?: string
          title?: string
        }
        Relationships: []
      }
      weekly_learning_logs: {
        Row: {
          calibration_version: string | null
          created_at: string
          duration_ms: number | null
          error_message: string | null
          evaluation_result: Json | null
          governance_alerts_triggered: number | null
          id: string
          run_finished_at: string | null
          run_started_at: string
          success: boolean
          weekly_stats: Json | null
        }
        Insert: {
          calibration_version?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          evaluation_result?: Json | null
          governance_alerts_triggered?: number | null
          id?: string
          run_finished_at?: string | null
          run_started_at?: string
          success?: boolean
          weekly_stats?: Json | null
        }
        Update: {
          calibration_version?: string | null
          created_at?: string
          duration_ms?: number | null
          error_message?: string | null
          evaluation_result?: Json | null
          governance_alerts_triggered?: number | null
          id?: string
          run_finished_at?: string | null
          run_started_at?: string
          success?: boolean
          weekly_stats?: Json | null
        }
        Relationships: []
      }
    }
    Views: {
      accountability_nodes_public: {
        Row: {
          country: string | null
          created_at: string | null
          id: string | null
          joined_at: string | null
          jurisdiction: string | null
          last_active_at: string | null
          metadata: Json | null
          org_name: string | null
          org_type: Database["public"]["Enums"]["org_type"] | null
          rate_limit_per_hour: number | null
          updated_at: string | null
          verified: boolean | null
        }
        Insert: {
          country?: string | null
          created_at?: string | null
          id?: string | null
          joined_at?: string | null
          jurisdiction?: string | null
          last_active_at?: string | null
          metadata?: Json | null
          org_name?: string | null
          org_type?: Database["public"]["Enums"]["org_type"] | null
          rate_limit_per_hour?: number | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Update: {
          country?: string | null
          created_at?: string | null
          id?: string | null
          joined_at?: string | null
          jurisdiction?: string | null
          last_active_at?: string | null
          metadata?: Json | null
          org_name?: string | null
          org_type?: Database["public"]["Enums"]["org_type"] | null
          rate_limit_per_hour?: number | null
          updated_at?: string | null
          verified?: boolean | null
        }
        Relationships: []
      }
      action_effectiveness: {
        Row: {
          action_type: string | null
          avg_impact: number | null
          domain: string | null
          success_rate_pct: number | null
          times_accepted: number | null
          times_recommended: number | null
          times_successful: number | null
        }
        Relationships: []
      }
      action_effectiveness_leaderboard: {
        Row: {
          action_type: string | null
          avg_impact: number | null
          avg_roi: number | null
          domain_count: number | null
          success_rate_pct: number | null
          times_accepted: number | null
          times_recommended: number | null
          times_successful: number | null
        }
        Relationships: []
      }
      action_reliability_view: {
        Row: {
          acceptance_count: number | null
          action_type: string | null
          avg_impact: number | null
          avg_roi: number | null
          ci_lower_pct: number | null
          ci_upper_pct: number | null
          domain: string | null
          measured_sample_size: number | null
          reliability_band: string | null
          sample_size: number | null
          success_count: number | null
          success_rate_pct: number | null
        }
        Relationships: []
      }
      aicis_unresolved_place_candidates: {
        Row: {
          country_hint: string | null
          extracted_place: string | null
          last_seen: string | null
          mention_count: number | null
          reasons: string[] | null
          sources: string[] | null
        }
        Relationships: []
      }
      canonical_country_list: {
        Row: {
          canonical_name: string | null
          entity_type: string | null
          id: string | null
          iso3: string | null
        }
        Insert: {
          canonical_name?: string | null
          entity_type?: never
          id?: string | null
          iso3?: string | null
        }
        Update: {
          canonical_name?: string | null
          entity_type?: never
          id?: string | null
          iso3?: string | null
        }
        Relationships: []
      }
      canonical_mismatch_audit: {
        Row: {
          code: string | null
          detail: string | null
          issue_type: string | null
        }
        Relationships: []
      }
      canonical_reporting_countries: {
        Row: {
          canonical_name: string | null
          display_name: string | null
          id: string | null
          iso3: string | null
          lat: number | null
          lon: number | null
          sovereignty_status: string | null
          trust_score: number | null
        }
        Insert: {
          canonical_name?: string | null
          display_name?: string | null
          id?: string | null
          iso3?: string | null
          lat?: number | null
          lon?: number | null
          sovereignty_status?: never
          trust_score?: number | null
        }
        Update: {
          canonical_name?: string | null
          display_name?: string | null
          id?: string | null
          iso3?: string | null
          lat?: number | null
          lon?: number | null
          sovereignty_status?: never
          trust_score?: number | null
        }
        Relationships: []
      }
      controlled_pilot_run_status: {
        Row: {
          accepted_action_ids: string[] | null
          accepted_at: string | null
          accepted_by: string | null
          cohort_size: number | null
          completed_at: string | null
          notes: string | null
          outcomes_logged_count: number | null
          pilot_run_id: string | null
          status: string | null
        }
        Relationships: []
      }
      country_coverage_full: {
        Row: {
          canonical_name: string | null
          display_name: string | null
          entity_type: string | null
          event_count: number | null
          id: string | null
          iso3: string | null
          lat: number | null
          lon: number | null
          metric_count: number | null
          source_count: number | null
          sovereignty_status: string | null
          trust_score: number | null
        }
        Insert: {
          canonical_name?: string | null
          display_name?: string | null
          entity_type?: never
          event_count?: never
          id?: string | null
          iso3?: string | null
          lat?: number | null
          lon?: number | null
          metric_count?: never
          source_count?: number | null
          sovereignty_status?: never
          trust_score?: number | null
        }
        Update: {
          canonical_name?: string | null
          display_name?: string | null
          entity_type?: never
          event_count?: never
          id?: string | null
          iso3?: string | null
          lat?: number | null
          lon?: number | null
          metric_count?: never
          source_count?: number | null
          sovereignty_status?: never
          trust_score?: number | null
        }
        Relationships: []
      }
      country_reconciliation_audit: {
        Row: {
          coverage_reporting_diff: number | null
          duplicate_iso3_count: number | null
          total_aggregates: number | null
          total_coverage: number | null
          total_deprecated: number | null
          total_reporting: number | null
          total_source_only: number | null
          unmapped_metric_codes: number | null
        }
        Relationships: []
      }
      daily_accumulation: {
        Row: {
          count: number | null
          day: string | null
          metric: string | null
        }
        Relationships: []
      }
      domain_evidence_summary: {
        Row: {
          accepted_count: number | null
          active_failure_count: number | null
          audit_event_count: number | null
          avg_roi: number | null
          completed_count: number | null
          domain: string | null
          executed_count: number | null
          measured_7d: number | null
          measured_count: number | null
          postmortem_rate: number | null
          total_decisions: number | null
        }
        Relationships: []
      }
      dq_inference_run_health: {
        Row: {
          failed_24h: number | null
          function_name: string | null
          last_run_at: string | null
          ok_24h: number | null
          rows_written_24h: number | null
          runs_24h: number | null
          three_consecutive_failures: boolean | null
          zero_24h: number | null
        }
        Relationships: []
      }
      dq_orphan_regions: {
        Row: {
          admin_level: number | null
          missing_centroid: number | null
          missing_iso3: number | null
          missing_parent: number | null
          missing_population: number | null
        }
        Relationships: []
      }
      dq_seed_retry_status: {
        Row: {
          best_villages_found: number | null
          country_iso3: string | null
          last_attempt_at: string | null
          last_error: string | null
          next_retry_at: string | null
          retry_count: number | null
          retry_state: string | null
        }
        Relationships: []
      }
      dq_village_layer_health: {
        Row: {
          country_iso3: string | null
          freshness_status: string | null
          hours_since_last: number | null
          last_observed_at: string | null
          regions_with_data: number | null
          rows_24h: number | null
          rows_7d: number | null
          village_rows: number | null
        }
        Relationships: []
      }
      organizations_member_view: {
        Row: {
          api_enabled: boolean | null
          billing_status: string | null
          created_at: string | null
          feature_flags: Json | null
          id: string | null
          max_api_keys: number | null
          monthly_api_quota: number | null
          name: string | null
          owner_id: string | null
          status: string | null
          tier: string | null
          updated_at: string | null
          white_label_enabled: boolean | null
        }
        Insert: {
          api_enabled?: boolean | null
          billing_status?: string | null
          created_at?: string | null
          feature_flags?: Json | null
          id?: string | null
          max_api_keys?: number | null
          monthly_api_quota?: number | null
          name?: string | null
          owner_id?: string | null
          status?: string | null
          tier?: string | null
          updated_at?: string | null
          white_label_enabled?: boolean | null
        }
        Update: {
          api_enabled?: boolean | null
          billing_status?: string | null
          created_at?: string | null
          feature_flags?: Json | null
          id?: string | null
          max_api_keys?: number | null
          monthly_api_quota?: number | null
          name?: string | null
          owner_id?: string | null
          status?: string | null
          tier?: string | null
          updated_at?: string | null
          white_label_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations_safe_view: {
        Row: {
          api_enabled: boolean | null
          billing_status: string | null
          cancel_at_period_end: boolean | null
          created_at: string | null
          feature_flags: Json | null
          id: string | null
          max_api_keys: number | null
          monthly_api_quota: number | null
          name: string | null
          owner_id: string | null
          status: string | null
          tier: string | null
          trial_ends_at: string | null
          updated_at: string | null
          white_label_enabled: boolean | null
        }
        Insert: {
          api_enabled?: boolean | null
          billing_status?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          feature_flags?: Json | null
          id?: string | null
          max_api_keys?: number | null
          monthly_api_quota?: number | null
          name?: string | null
          owner_id?: string | null
          status?: string | null
          tier?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          white_label_enabled?: boolean | null
        }
        Update: {
          api_enabled?: boolean | null
          billing_status?: string | null
          cancel_at_period_end?: boolean | null
          created_at?: string | null
          feature_flags?: Json | null
          id?: string | null
          max_api_keys?: number | null
          monthly_api_quota?: number | null
          name?: string | null
          owner_id?: string | null
          status?: string | null
          tier?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
          white_label_enabled?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      pilot_execution_queue: {
        Row: {
          accepted_at: string | null
          adjusted_priority_score: number | null
          adjustment_rationale: string | null
          confidence: number | null
          country_iso3: string | null
          created_at: string | null
          domain: string | null
          estimated_cost_eur: number | null
          estimated_roi_eur: number | null
          executed_at: string | null
          id: string | null
          intervention_quality_score: number | null
          intervention_title: string | null
          intervention_type: string | null
          learning_multiplier: number | null
          linked_outcome_id: string | null
          outcome_logged_at: string | null
          outcome_needed: boolean | null
          pilot_priority_score: number | null
          queue_stage: string | null
          rank_position: number | null
          rationale_md: string | null
          roi_factor: number | null
          stage_age_days: number | null
          status: string | null
          urgency_factor: number | null
          urgency_hours: number | null
          urgency_window: string | null
        }
        Relationships: []
      }
      pilot_outcome_evidence_badges: {
        Row: {
          evidence_badge: string | null
          evidence_checklist: Json | null
          evidence_quality_score: number | null
          excluded_from_learning: boolean | null
          outcome_confidence: string | null
          outcome_id: string | null
          outcome_success: boolean | null
        }
        Insert: {
          evidence_badge?: never
          evidence_checklist?: Json | null
          evidence_quality_score?: number | null
          excluded_from_learning?: never
          outcome_confidence?: string | null
          outcome_id?: string | null
          outcome_success?: boolean | null
        }
        Update: {
          evidence_badge?: never
          evidence_checklist?: Json | null
          evidence_quality_score?: number | null
          excluded_from_learning?: never
          outcome_confidence?: string | null
          outcome_id?: string | null
          outcome_success?: boolean | null
        }
        Relationships: []
      }
      pilot_truth_feed: {
        Row: {
          absolute_error: number | null
          accepted_at: string | null
          action_id: string | null
          action_status: string | null
          action_taken: boolean | null
          direction_hit: boolean | null
          dismissed_at: string | null
          domain: string | null
          estimated_roi_eur: number | null
          evaluation_locked: boolean | null
          executed_at: string | null
          forecast_id: string | null
          forecast_realized_at: string | null
          intervention_title: string | null
          intervention_type: string | null
          iso3: string | null
          measured_impact_score: number | null
          net_value: number | null
          outcome_id: string | null
          outcome_logged_at: string | null
          outcome_recorded_at: string | null
          outcome_success: boolean | null
          predicted_at: string | null
          recommended_action: string | null
          review_status: string | null
          roi_estimate: number | null
          roi_realization_ratio: number | null
          signal_title: string | null
          urgency_window: string | null
        }
        Relationships: []
      }
      pilot_weekly_metrics: {
        Row: {
          accepted_open_count: number | null
          accepted_this_week: number | null
          executed_open_count: number | null
          executed_this_week: number | null
          outcome_needed_count: number | null
          outcomes_logged_this_week: number | null
          proposed_open_count: number | null
        }
        Relationships: []
      }
      planetary_country_integrity: {
        Row: {
          canonical_name: string | null
          data_status: string | null
          distinct_metrics: number | null
          iso3: string | null
          link_count: number | null
          metric_count: number | null
          sovereignty_status: string | null
        }
        Insert: {
          canonical_name?: string | null
          data_status?: never
          distinct_metrics?: never
          iso3?: string | null
          link_count?: never
          metric_count?: never
          sovereignty_status?: never
        }
        Update: {
          canonical_name?: string | null
          data_status?: never
          distinct_metrics?: never
          iso3?: string | null
          link_count?: never
          metric_count?: never
          sovereignty_status?: never
        }
        Relationships: []
      }
      planetary_cron_health: {
        Row: {
          error_count: number | null
          job_name: string | null
          last_run_at: string | null
          still_running: number | null
          success_count: number | null
          success_rate_pct: number | null
          timeout_count: number | null
          total_runs: number | null
        }
        Relationships: []
      }
      planetary_duplicate_rate: {
        Row: {
          conflict_rate_pct: number | null
          estimated_conflicts: number | null
          provider_name: string | null
          total_rows: number | null
          unique_keys: number | null
        }
        Relationships: []
      }
      planetary_job_offsets: {
        Row: {
          current_offset: number | null
          job_key: string | null
          last_tick: string | null
        }
        Insert: {
          current_offset?: number | null
          job_key?: string | null
          last_tick?: string | null
        }
        Update: {
          current_offset?: number | null
          job_key?: string | null
          last_tick?: string | null
        }
        Relationships: []
      }
      planetary_scale_status: {
        Row: {
          coverage_countries: number | null
          entities_total: number | null
          entity_links_total: number | null
          event_links_total: number | null
          link_to_metric_pct: number | null
          metric_links_total: number | null
          metrics_country_coverage: number | null
          metrics_total: number | null
          provenance_sources: number | null
          provenance_to_metric_pct: number | null
          reporting_countries: number | null
        }
        Relationships: []
      }
      quantivis_country_dashboard: {
        Row: {
          avg_freshness: number | null
          country_name: string | null
          domain_count: number | null
          is_reporting_entity: boolean | null
          iso3: string | null
          latest_data_at: string | null
          link_count: number | null
          provider_count: number | null
          sovereignty_status: string | null
          total_metrics: number | null
        }
        Relationships: []
      }
      quantivis_cross_border_signals: {
        Row: {
          affected_iso3: string[] | null
          description: string | null
          detected_at: string | null
          domain: string | null
          id: string | null
          intensity: number | null
          metadata: Json | null
          origin_iso3: string | null
          signal_type: string | null
        }
        Insert: {
          affected_iso3?: string[] | null
          description?: string | null
          detected_at?: string | null
          domain?: string | null
          id?: string | null
          intensity?: number | null
          metadata?: Json | null
          origin_iso3?: string | null
          signal_type?: string | null
        }
        Update: {
          affected_iso3?: string[] | null
          description?: string | null
          detected_at?: string | null
          domain?: string | null
          id?: string | null
          intensity?: number | null
          metadata?: Json | null
          origin_iso3?: string | null
          signal_type?: string | null
        }
        Relationships: []
      }
      quantivis_cross_domain_influence: {
        Row: {
          computed_at: string | null
          id: string | null
          lag_days: number | null
          region: string | null
          sample_size: number | null
          source_domain: string | null
          target_domain: string | null
          transfer_strength: number | null
        }
        Insert: {
          computed_at?: string | null
          id?: string | null
          lag_days?: number | null
          region?: string | null
          sample_size?: number | null
          source_domain?: string | null
          target_domain?: string | null
          transfer_strength?: number | null
        }
        Update: {
          computed_at?: string | null
          id?: string | null
          lag_days?: number | null
          region?: string | null
          sample_size?: number | null
          source_domain?: string | null
          target_domain?: string | null
          transfer_strength?: number | null
        }
        Relationships: []
      }
      quantivis_entity_graph: {
        Row: {
          canonical_name: string | null
          entity_id: string | null
          entity_type: string | null
          event_count: number | null
          is_reporting_entity: boolean | null
          iso3: string | null
          metric_count: number | null
          sovereignty_status: string | null
        }
        Relationships: []
      }
      quantivis_entity_links: {
        Row: {
          created_at: string | null
          id: string | null
          link_source: string | null
          link_type: Database["public"]["Enums"]["entity_link_type"] | null
          source_entity_id: string | null
          source_iso3: string | null
          source_name: string | null
          source_type: Database["public"]["Enums"]["entity_type"] | null
          strength: number | null
          target_entity_id: string | null
          target_iso3: string | null
          target_name: string | null
          target_type: Database["public"]["Enums"]["entity_type"] | null
        }
        Relationships: [
          {
            foreignKeyName: "entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_source_entity_id_fkey"
            columns: ["source_entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_country_list"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_entities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "canonical_reporting_countries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "country_coverage_full"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "entity_links_target_entity_id_fkey"
            columns: ["target_entity_id"]
            isOneToOne: false
            referencedRelation: "quantivis_entity_graph"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      quantivis_event_feed: {
        Row: {
          description: string | null
          entity_name: string | null
          entity_type: Database["public"]["Enums"]["entity_type"] | null
          event_date: string | null
          event_id: string | null
          event_type: string | null
          ingested_at: string | null
          iso3: string | null
          provider_name: string | null
          severity: number | null
          source_url: string | null
          title: string | null
        }
        Relationships: []
      }
      quantivis_prediction_outcomes: {
        Row: {
          actual_label: number | null
          brier_score: number | null
          country_iso3: string | null
          delta_performance: number | null
          domain: string | null
          error: number | null
          horizon_days: number | null
          id: string | null
          predicted_at: string | null
          predicted_probability: number | null
          prediction_id: string | null
          realized_at: string | null
          surprise: boolean | null
        }
        Insert: {
          actual_label?: number | null
          brier_score?: number | null
          country_iso3?: string | null
          delta_performance?: number | null
          domain?: string | null
          error?: number | null
          horizon_days?: number | null
          id?: string | null
          predicted_at?: string | null
          predicted_probability?: number | null
          prediction_id?: string | null
          realized_at?: string | null
          surprise?: boolean | null
        }
        Update: {
          actual_label?: number | null
          brier_score?: number | null
          country_iso3?: string | null
          delta_performance?: number | null
          domain?: string | null
          error?: number | null
          horizon_days?: number | null
          id?: string | null
          predicted_at?: string | null
          predicted_probability?: number | null
          prediction_id?: string | null
          realized_at?: string | null
          surprise?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "risk_prediction_realizations_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: true
            referencedRelation: "quantivis_risk_predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_prediction_realizations_prediction_id_fkey"
            columns: ["prediction_id"]
            isOneToOne: true
            referencedRelation: "risk_ranking_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      quantivis_recommended_actions: {
        Row: {
          confidence: number | null
          country_iso3: string | null
          domain: string | null
          estimated_cost_eur: number | null
          estimated_roi_eur: number | null
          expected_roi_lower: number | null
          expected_roi_upper: number | null
          generated_at: string | null
          id: string | null
          intervention_title: string | null
          intervention_type: string | null
          rationale_md: string | null
          status: string | null
          urgency_hours: number | null
          urgency_window: string | null
        }
        Insert: {
          confidence?: number | null
          country_iso3?: string | null
          domain?: string | null
          estimated_cost_eur?: number | null
          estimated_roi_eur?: number | null
          expected_roi_lower?: number | null
          expected_roi_upper?: number | null
          generated_at?: string | null
          id?: string | null
          intervention_title?: string | null
          intervention_type?: string | null
          rationale_md?: string | null
          status?: string | null
          urgency_hours?: number | null
          urgency_window?: string | null
        }
        Update: {
          confidence?: number | null
          country_iso3?: string | null
          domain?: string | null
          estimated_cost_eur?: number | null
          estimated_roi_eur?: number | null
          expected_roi_lower?: number | null
          expected_roi_upper?: number | null
          generated_at?: string | null
          id?: string | null
          intervention_title?: string | null
          intervention_type?: string | null
          rationale_md?: string | null
          status?: string | null
          urgency_hours?: number | null
          urgency_window?: string | null
        }
        Relationships: []
      }
      quantivis_risk_predictions: {
        Row: {
          confidence_lower: number | null
          confidence_upper: number | null
          country_iso3: string | null
          domain: string | null
          evidence_count: number | null
          factors: Json | null
          generated_at: string | null
          generation_batch_id: string | null
          horizon_days: number | null
          id: string | null
          model_version: string | null
          proxy_share: number | null
          rank_position: number | null
          risk_probability: number | null
        }
        Insert: {
          confidence_lower?: number | null
          confidence_upper?: number | null
          country_iso3?: string | null
          domain?: string | null
          evidence_count?: number | null
          factors?: Json | null
          generated_at?: string | null
          generation_batch_id?: string | null
          horizon_days?: number | null
          id?: string | null
          model_version?: string | null
          proxy_share?: number | null
          rank_position?: number | null
          risk_probability?: number | null
        }
        Update: {
          confidence_lower?: number | null
          confidence_upper?: number | null
          country_iso3?: string | null
          domain?: string | null
          evidence_count?: number | null
          factors?: Json | null
          generated_at?: string | null
          generation_batch_id?: string | null
          horizon_days?: number | null
          id?: string | null
          model_version?: string | null
          proxy_share?: number | null
          rank_position?: number | null
          risk_probability?: number | null
        }
        Relationships: []
      }
      quantivis_signals_feed: {
        Row: {
          confidence: number | null
          domain: string | null
          entity_name: string | null
          entity_type: Database["public"]["Enums"]["entity_type"] | null
          freshness_score: number | null
          ingested_at: string | null
          iso3: string | null
          metric_name: string | null
          period: string | null
          provenance_observed_at: string | null
          signal_id: string | null
          source_provider: string | null
          source_url: string | null
          sovereignty_status:
            | Database["public"]["Enums"]["sovereignty_status"]
            | null
          unit: string | null
          value: number | null
        }
        Relationships: []
      }
      recommendation_quality_score: {
        Row: {
          accepted_n: number | null
          avg_roi_realization: number | null
          dismissal_rate: number | null
          dismissed_n: number | null
          executed_n: number | null
          execution_rate: number | null
          intervention_type: string | null
          outcome_n: number | null
          quality_score: number | null
          sample_confidence: number | null
          score_explanation: string | null
          scored_n: number | null
          strong_outcome_n: number | null
          success_n: number | null
          success_rate: number | null
          total_proposed: number | null
          weak_outcome_n: number | null
        }
        Relationships: []
      }
      risk_action_lifecycle_metrics: {
        Row: {
          accepted_count: number | null
          action_conversion_rate: number | null
          dismissed_count: number | null
          executed_count: number | null
          expired_count: number | null
          outcome_logged_count: number | null
          proposed_count: number | null
          stale_proposed_count: number | null
        }
        Relationships: []
      }
      risk_action_performance_summary: {
        Row: {
          accepted_count: number | null
          avg_net_value: number | null
          avg_roi_realization_ratio: number | null
          country_iso3: string | null
          dismissed_count: number | null
          domain: string | null
          executed_count: number | null
          expired_count: number | null
          intervention_type: string | null
          last_outcome_at: string | null
          outcome_logged_count: number | null
          strong_outcome_count: number | null
          success_rate: number | null
          total_count: number | null
          weak_outcome_count: number | null
        }
        Relationships: []
      }
      risk_action_recommendations_adjusted: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          adjusted_priority_score: number | null
          adjustment_rationale: string | null
          adjustment_sample_size: number | null
          batch_id: string | null
          confidence: number | null
          counterfactual_md: string | null
          country_iso3: string | null
          created_at: string | null
          dismissal_reason: string | null
          dismissed_at: string | null
          dismissed_by: string | null
          domain: string | null
          estimated_cost_eur: number | null
          estimated_roi_eur: number | null
          evidence_chain: Json | null
          executed_at: string | null
          executed_by: string | null
          execution_note: string | null
          expected_roi_lower: number | null
          expected_roi_upper: number | null
          first_approver: string | null
          generated_at: string | null
          id: string | null
          intervention_quality_score: number | null
          intervention_title: string | null
          intervention_type: string | null
          learning_multiplier: number | null
          lifecycle_audit_hash: string | null
          linked_outcome_id: string | null
          outcome_logged_at: string | null
          outcome_logged_by: string | null
          outcome_notes_md: string | null
          rank_position: number | null
          ranking_id: string | null
          rationale_md: string | null
          requires_dual_approval: boolean | null
          responsible_domain: string | null
          risk_probability: number | null
          second_approver: string | null
          status: string | null
          updated_at: string | null
          urgency_hours: number | null
          urgency_window: string | null
        }
        Relationships: [
          {
            foreignKeyName: "risk_action_recommendations_ranking_id_fkey"
            columns: ["ranking_id"]
            isOneToOne: false
            referencedRelation: "quantivis_risk_predictions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "risk_action_recommendations_ranking_id_fkey"
            columns: ["ranking_id"]
            isOneToOne: false
            referencedRelation: "risk_ranking_predictions"
            referencedColumns: ["id"]
          },
        ]
      }
      risk_rankings_current: {
        Row: {
          confidence_lower: number | null
          confidence_upper: number | null
          country_iso3: string | null
          domain: string | null
          evidence_count: number | null
          factors: Json | null
          generated_at: string | null
          generation_batch_id: string | null
          horizon_days: number | null
          model_version: string | null
          proxy_share: number | null
          rank_position: number | null
          risk_probability: number | null
        }
        Relationships: []
      }
      risk_rankings_current_v: {
        Row: {
          confidence_lower: number | null
          confidence_upper: number | null
          country_iso3: string | null
          domain: string | null
          evidence_count: number | null
          factors: Json | null
          generated_at: string | null
          generation_batch_id: string | null
          horizon_days: number | null
          model_version: string | null
          proxy_share: number | null
          rank_position: number | null
          risk_probability: number | null
        }
        Relationships: []
      }
      system_slo_recent_v: {
        Row: {
          enabled: boolean | null
          fail_24h: number | null
          last_failure_at: string | null
          last_success_at: string | null
          ok_24h: number | null
          pipeline_name: string | null
          schedule: string | null
        }
        Relationships: []
      }
      system_trust_score: {
        Row: {
          acceptance_rate: number | null
          calibration_error: number | null
          evaluated_at: string | null
          model_version: string | null
          outcome_maturity_ratio: number | null
          trust_score: number | null
        }
        Relationships: []
      }
      v_forecast_truth_split: {
        Row: {
          days_since_harness_freeze: number | null
          harness_v1_frozen_at: string | null
          score_a_locked_prospective_count: number | null
          score_a_maturity: string | null
          score_a_measured_accuracy: number | null
          score_a_sample_size: number | null
          score_a_untampered_validation_count: number | null
          score_b_mean_absolute_error: number | null
          score_b_operational_confidence: number | null
          score_b_sample_size: number | null
        }
        Relationships: []
      }
      v_layer_trust_tiers: {
        Row: {
          display_order: number | null
          layer: string | null
          rationale: string | null
          tier: string | null
        }
        Relationships: []
      }
      v_local_to_national_freshness: {
        Row: {
          chain_status: string | null
          country_iso3: string | null
          last_community: string | null
          last_l0: string | null
          last_national: string | null
          last_urban: string | null
          regions: number | null
          regions_with_pop: number | null
        }
        Relationships: []
      }
      v_lril_geo_audit_null_iso3: {
        Row: {
          null_iso3_count: number | null
          source_name: string | null
        }
        Relationships: []
      }
      v_lril_geo_audit_top_unresolved_places: {
        Row: {
          iso3: string | null
          mention_count: number | null
          phrase: string | null
        }
        Relationships: []
      }
      v_lril_geo_audit_unresolved: {
        Row: {
          iso3: string | null
          language: string | null
          last_seen: string | null
          source_name: string | null
          unresolved_signals: number | null
        }
        Relationships: []
      }
      v_lril_unresolved_geo_evidence: {
        Row: {
          extracted_place: string | null
          first_seen: string | null
          iso3: string | null
          last_seen: string | null
          occurrences: number | null
          reason_unresolved: string | null
        }
        Relationships: []
      }
      v_lril_warning_false_positive_risk: {
        Row: {
          confidence: number | null
          event_count: number | null
          first_detected_at: string | null
          fp_risk_tier: string | null
          fp_score: number | null
          id: string | null
          iso3: string | null
          locality: string | null
          severity: number | null
          source_count: number | null
          subtype: string | null
          warning_kind: string | null
        }
        Insert: {
          confidence?: number | null
          event_count?: number | null
          first_detected_at?: string | null
          fp_risk_tier?: never
          fp_score?: never
          id?: string | null
          iso3?: string | null
          locality?: string | null
          severity?: number | null
          source_count?: number | null
          subtype?: string | null
          warning_kind?: string | null
        }
        Update: {
          confidence?: number | null
          event_count?: number | null
          first_detected_at?: string | null
          fp_risk_tier?: never
          fp_score?: never
          id?: string | null
          iso3?: string | null
          locality?: string | null
          severity?: number | null
          source_count?: number | null
          subtype?: string | null
          warning_kind?: string | null
        }
        Relationships: []
      }
      v_lril_warning_quality: {
        Row: {
          avg_confidence: number | null
          avg_escalation: number | null
          avg_event_count: number | null
          avg_severity: number | null
          avg_source_count: number | null
          high_conf_count: number | null
          low_conf_count: number | null
          open_count: number | null
          total: number | null
          warning_kind: string | null
        }
        Relationships: []
      }
      v_outcome_cockpit_queue: {
        Row: {
          accepted_at: string | null
          action_id: string | null
          country_iso3: string | null
          days_pending: number | null
          domain: string | null
          estimated_roi_eur: number | null
          executed_at: string | null
          intervention_title: string | null
          outcome_logged_at: string | null
          pilot_run_id: string | null
          review_reason: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pilot_run_actions_pilot_run_id_fkey"
            columns: ["pilot_run_id"]
            isOneToOne: false
            referencedRelation: "controlled_pilot_run_status"
            referencedColumns: ["pilot_run_id"]
          },
          {
            foreignKeyName: "pilot_run_actions_pilot_run_id_fkey"
            columns: ["pilot_run_id"]
            isOneToOne: false
            referencedRelation: "pilot_runs"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      aggregate_country_snapshots: {
        Args: { _snapshot_date: string }
        Returns: {
          avg_confidence: number
          avg_fragility: number
          avg_momentum: number
          avg_performance: number
          avg_risk: number
          domain_count: number
          domains_down: number
          domains_up: number
          iso3: string
          total_breaks: number
        }[]
      }
      archive_normalized_metrics_older_than: {
        Args: { _days?: number }
        Returns: Json
      }
      audit_prospective_match_quality: { Args: never; Returns: Json }
      auto_review_decisions: { Args: { _batch_size?: number }; Returns: Json }
      batch_expand_entities: { Args: { _batch_size?: number }; Returns: Json }
      batch_generate_entity_links: {
        Args: { _batch_size?: number }
        Returns: Json
      }
      batch_generate_event_links: {
        Args: { p_batch_size?: number }
        Returns: Json
      }
      batch_generate_links: { Args: { _batch_size?: number }; Returns: Json }
      batch_migrate_snapshots: { Args: { _batch_size?: number }; Returns: Json }
      batch_migrate_villages: { Args: { _batch_size?: number }; Returns: Json }
      bridge_decision_to_outcome: {
        Args: { _decision_id: string }
        Returns: string
      }
      build_training_dataset_aicis:
        | {
            Args: {
              p_end_date: string
              p_horizon_days?: number
              p_start_date: string
            }
            Returns: {
              build_seconds: number
              rows_inserted: number
              rows_with_label: number
            }[]
          }
        | {
            Args: {
              p_end_date: string
              p_horizon_days: number
              p_iso3_filter: string
              p_start_date: string
            }
            Returns: {
              build_seconds: number
              rows_inserted: number
              rows_with_label: number
            }[]
          }
      check_accumulation_health: { Args: never; Returns: Json }
      check_daily_accumulation_misses: { Args: never; Returns: Json }
      check_ip_access: {
        Args: { _ip_address: unknown; _org_id: string }
        Returns: boolean
      }
      check_pilot_scaling_guard: {
        Args: { p_requested_cohort_size: number }
        Returns: Json
      }
      check_prospective_health: { Args: never; Returns: Json }
      check_rate_limit: {
        Args: {
          _endpoint: string
          _ip: unknown
          _limit?: number
          _user_id: string
          _window_minutes?: number
        }
        Returns: boolean
      }
      cleanup_expired_exports: { Args: never; Returns: undefined }
      cleanup_rate_limits: { Args: never; Returns: undefined }
      cleanup_zombie_jobs: { Args: never; Returns: undefined }
      compute_cross_domain_influence: { Args: never; Returns: Json }
      compute_early_warnings: {
        Args: never
        Returns: {
          warnings_created: number
          warnings_updated: number
        }[]
      }
      compute_intelligence_score: {
        Args: { _change_threshold?: number; _window_days?: number }
        Returns: Json
      }
      compute_intelligence_score_v2: {
        Args: { _change_threshold?: number; _window_days?: number }
        Returns: Json
      }
      compute_prospective_score: { Args: never; Returns: Json }
      compute_risk_propagation: {
        Args: never
        Returns: {
          batch_id: string
          rows_inserted: number
        }[]
      }
      compute_risk_ranking_baseline: {
        Args: { p_top_n?: number }
        Returns: {
          batch_id: string
          rows_inserted: number
        }[]
      }
      compute_risk_scores: { Args: never; Returns: Json }
      compute_uptime_snapshot: { Args: never; Returns: Json }
      count_districts_needing_settlements: { Args: never; Returns: number }
      count_uncovered_regions: { Args: never; Returns: number }
      country_l0_is_stale: {
        Args: { _iso3: string; _max_hours?: number }
        Returns: boolean
      }
      enqueue_quantivis_event_batch: {
        Args: { p_limit?: number }
        Returns: Json
      }
      enqueue_quantivis_metric_batch: {
        Args: { p_limit?: number }
        Returns: Json
      }
      enqueue_quantivis_webhook: {
        Args: { p_event_type: string; p_payload: Json; p_target_url?: string }
        Returns: string
      }
      ensure_admin_region_demographics: { Args: never; Returns: Json }
      ensure_country_profiles_from_normalized: { Args: never; Returns: number }
      ensure_l0_reporting_anchors: { Args: never; Returns: number }
      evaluate_auto_block: { Args: never; Returns: Json }
      evaluate_forecast_readiness: {
        Args: { _mae_threshold?: number }
        Returns: Json
      }
      expire_stale_risk_actions: {
        Args: never
        Returns: {
          expired_count: number
        }[]
      }
      find_stalled_pipelines: {
        Args: never
        Returns: {
          consecutive_failures: number
          expected_interval_minutes: number
          minutes_since_success: number
          pipeline_name: string
          severity: string
          target_function: string
        }[]
      }
      generate_risk_action_recommendations: {
        Args: { p_top_n?: number }
        Returns: {
          batch_id: string
          generated: number
        }[]
      }
      geonames_bulk_upsert: {
        Args: { p_rows: Json }
        Returns: {
          aliases_inserted: number
          entities_inserted: number
          entities_updated: number
        }[]
      }
      geonames_ingest_chunk: {
        Args: { p_limit: number; p_offset: number }
        Returns: {
          aliases_inserted: number
          entities_inserted: number
          entities_updated: number
        }[]
      }
      get_countries_needing_villages: {
        Args: never
        Returns: {
          country_iso3: string
        }[]
      }
      get_districts_needing_settlements: {
        Args: { _limit?: number }
        Returns: {
          admin_level: number
          country_iso3: string
          id: string
          lat: number
          lon: number
          name: string
          population_est: number
        }[]
      }
      get_public_status: { Args: never; Returns: Json }
      get_region_hierarchy: {
        Args: { _country_iso3: string; _max_level?: number }
        Returns: {
          admin_level: number
          id: string
          indicator_count: number
          lat: number
          lon: number
          name: string
          parent_id: string
          population_est: number
          urban_rural: string
        }[]
      }
      get_uncovered_regions: {
        Args: { _limit?: number }
        Returns: {
          admin_level: number
          country_iso3: string
          id: string
          lat: number
          lon: number
          name: string
          population_est: number
          urban_rural: string
        }[]
      }
      get_user_org: {
        Args: { _user_id: string }
        Returns: {
          api_enabled: boolean | null
          billing_status: string | null
          cancel_at_period_end: boolean | null
          created_at: string | null
          feature_flags: Json | null
          id: string
          max_api_keys: number | null
          monthly_api_quota: number | null
          name: string
          owner_id: string | null
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          tier: string | null
          trial_ends_at: string | null
          updated_at: string | null
          white_label_enabled: boolean | null
        }[]
        SetofOptions: {
          from: "*"
          to: "organizations"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_village_dashboard: {
        Args: { _region_id: string }
        Returns: {
          confidence: number
          data_source: string
          domain: string
          indicator: string
          observed_at: string
          unit: string
          value: number
        }[]
      }
      has_export_role: { Args: { _user_id: string }; Returns: boolean }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      infer_risk_probabilities: {
        Args: { p_horizon_days?: number }
        Returns: {
          batch_id: string
          rows_inserted: number
        }[]
      }
      is_canonical_iso3: { Args: { _iso3: string }; Returns: boolean }
      is_covered_iso3: { Args: { _iso3: string }; Returns: boolean }
      log_audit_event: {
        Args: {
          _action: string
          _ip_address?: unknown
          _metadata?: Json
          _org_id: string
          _resource_id?: string
          _resource_type?: string
          _severity?: string
          _user_agent?: string
          _user_id: string
        }
        Returns: string
      }
      log_pilot_scaling_override: {
        Args: { p_reason: string; p_requested_cohort_size: number }
        Returns: string
      }
      lril_bridge_to_normalized: {
        Args: never
        Returns: {
          bridged_count: number
        }[]
      }
      lril_claim_signals: {
        Args: { p_limit?: number }
        Returns: {
          country_hint: string
          id: string
          language: string
          published_at: string
          raw_text: string
          region_hint: string
          source_name: string
          source_reliability: number
          url: string
        }[]
      }
      lril_compute_confidence: {
        Args: {
          p_avg_source_reliability: number
          p_fatality_count?: number
          p_geo_confidence: number
          p_keyword_strength: number
          p_proxy_boost?: number
          p_source_count: number
          p_temporal_density: number
        }
        Returns: number
      }
      lril_compute_severity: {
        Args: {
          p_domain: string
          p_matched_keywords: Json
          p_source_reliability?: number
          p_subtype: string
          p_text: string
        }
        Returns: number
      }
      lril_detect_country_from_text: {
        Args: { p_text: string }
        Returns: string
      }
      lril_detect_keywords: {
        Args: { p_country?: string; p_language?: string; p_text: string }
        Returns: {
          domain: string
          matched_terms: Json
          score: number
          subtype: string
        }[]
      }
      lril_extract_place_phrases: {
        Args: { p_text: string }
        Returns: {
          kind: string
          phrase: string
          weight: number
        }[]
      }
      lril_fips_to_iso3: { Args: { p_code: string }; Returns: string }
      lril_is_negative_phrase: { Args: { p_phrase: string }; Returns: boolean }
      lril_promote_unresolved_to_aliases: {
        Args: { p_min_hits?: number; p_sim_threshold?: number }
        Returns: number
      }
      lril_release_stale_claims: {
        Args: { p_max_age_minutes?: number }
        Returns: number
      }
      lril_resolve_geo_fuzzy: {
        Args: { p_iso3: string; p_text: string }
        Returns: {
          admin_level_1: string
          geo_confidence: number
          geo_entity_id: string
          lat: number
          locality: string
          lon: number
          match_strength: number
        }[]
      }
      lril_resolve_geo_fuzzy_v2: {
        Args: { p_iso3: string; p_text: string }
        Returns: {
          admin_level_1: string
          geo_confidence: number
          geo_entity_id: string
          lat: number
          locality: string
          lon: number
          match_kind: string
          match_strength: number
        }[]
      }
      lril_resolve_geo_fuzzy_v3: {
        Args: { p_iso3: string; p_signal_id: string; p_text: string }
        Returns: {
          admin_level_1: string
          geo_confidence: number
          geo_entity_id: string
          lat: number
          locality: string
          lon: number
          match_kind: string
          match_strength: number
        }[]
      }
      lril_source_tier: {
        Args: { p_source: string; p_url: string }
        Returns: number
      }
      merge_entities_tx: {
        Args: {
          _confidence?: number
          _loser_id: string
          _merged_by?: string
          _reason: string
          _winner_id: string
        }
        Returns: Json
      }
      planetary_batch_tick: { Args: never; Returns: Json }
      prospective_accumulation_monitor: { Args: never; Returns: Json }
      prospective_coverage_gaps: { Args: never; Returns: Json }
      prospective_domain_breakdown: { Args: never; Returns: Json }
      prospective_horizon_breakdown: { Args: never; Returns: Json }
      prospective_model_breakdown: { Args: never; Returns: Json }
      prospective_summary_stats: { Args: never; Returns: Json }
      prune_retention_logs: { Args: never; Returns: Json }
      realize_due_prospective_forecasts: {
        Args: { limit_count?: number }
        Returns: {
          rows_realized: number
          run_id: string
        }[]
      }
      realize_risk_predictions: {
        Args: { p_horizon_days?: number }
        Returns: {
          perf_rows: number
          realized: number
          trust_rows: number
        }[]
      }
      refresh_quantivis_materialized: { Args: never; Returns: Json }
      refresh_recommendation_quality_scores: {
        Args: never
        Returns: {
          out_adjustment_multiplier: number
          out_intervention_type: string
          out_quality_score: number
          out_sample_size: number
        }[]
      }
      refresh_risk_rankings_current: { Args: never; Returns: undefined }
      register_pipeline_heartbeat: {
        Args: {
          _error?: string
          _metadata?: Json
          _pipeline_name: string
          _success?: boolean
        }
        Returns: undefined
      }
      rollup_community_to_urban: { Args: never; Returns: number }
      rollup_country_to_regional: { Args: never; Returns: number }
      run_accumulation_health_audit: { Args: never; Returns: Json }
      run_canary_probe: { Args: never; Returns: Json }
      run_milestone_audit: { Args: { _milestone?: string }; Returns: Json }
      run_simulation: {
        Args: {
          p_direction?: string
          p_domain: string
          p_iso3?: string
          p_magnitude: number
          p_name: string
        }
        Returns: string
      }
      schedule_village_seed_retry: {
        Args: { _error?: string; _iso3: string; _success: boolean }
        Returns: undefined
      }
      score_country_domain_risk: {
        Args: { p_domain: string; p_iso3: string }
        Returns: {
          factors: Json
          momentum_score: number
          risk_probability: number
          trend_score: number
          volatility_score: number
          zscore_recent: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      similarity_search_entities: {
        Args: {
          max_results?: number
          min_similarity?: number
          search_name: string
          search_type?: string
        }
        Returns: {
          canonical_name: string
          display_name: string
          entity_type: string
          id: string
          iso3: string
          lat: number
          lon: number
          match_source: string
          similarity: number
          source_count: number
          trust_score: number
        }[]
      }
      snap_planetary_stats: { Args: never; Returns: undefined }
      snapshot_prospective_health: { Args: never; Returns: Json }
      start_controlled_pilot_run: {
        Args: { p_action_ids: string[]; p_notes?: string }
        Returns: string
      }
      timeout_zombie_jobs: { Args: never; Returns: Json }
      transition_risk_action: {
        Args: {
          p_action_id: string
          p_dismissal_reason?: string
          p_execution_note?: string
          p_outcome_id?: string
          p_to_status: string
        }
        Returns: {
          accepted_at: string | null
          accepted_by: string | null
          batch_id: string
          confidence: number | null
          counterfactual_md: string | null
          country_iso3: string
          created_at: string
          dismissal_reason: string | null
          dismissed_at: string | null
          dismissed_by: string | null
          domain: string
          estimated_cost_eur: number | null
          estimated_roi_eur: number | null
          evidence_chain: Json | null
          executed_at: string | null
          executed_by: string | null
          execution_note: string | null
          expected_roi_lower: number | null
          expected_roi_upper: number | null
          first_approver: string | null
          generated_at: string
          id: string
          intervention_title: string
          intervention_type: string
          lifecycle_audit_hash: string | null
          linked_outcome_id: string | null
          outcome_logged_at: string | null
          outcome_logged_by: string | null
          outcome_notes_md: string | null
          rank_position: number | null
          ranking_id: string | null
          rationale_md: string | null
          requires_dual_approval: boolean | null
          responsible_domain: string
          risk_probability: number
          second_approver: string | null
          status: string
          updated_at: string
          urgency_hours: number
          urgency_window: string
        }
        SetofOptions: {
          from: "*"
          to: "risk_action_recommendations"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      traverse_entity_graph: {
        Args: { _depth?: number; _entity_id: string }
        Returns: {
          canonical_name: string
          connected_entity_id: string
          connected_name: string
          connected_type: string
          depth: number
          direction: string
          entity_id: string
          entity_type: string
          link_type: string
          strength: number
        }[]
      }
      trigger_legacy_unify: { Args: never; Returns: undefined }
      trigger_region_promote: { Args: never; Returns: undefined }
      trigger_signals_unify: { Args: never; Returns: undefined }
      trigger_village_unify: { Args: never; Returns: undefined }
      trigger_wb_ingest: { Args: never; Returns: undefined }
      unaccent: { Args: { "": string }; Returns: string }
      wilson_interval: {
        Args: { p_successes: number; p_total: number; p_z?: number }
        Returns: Json
      }
    }
    Enums: {
      access_tier: "public" | "institutional" | "administrative"
      alert_level:
        | "stable"
        | "monitoring"
        | "warning"
        | "critical"
        | "emergency"
      app_role: "admin" | "operator" | "observer"
      data_purpose:
        | "analytics"
        | "reporting"
        | "research"
        | "crisis_response"
        | "policy_making"
        | "audit"
      division_status:
        | "optimal"
        | "operational"
        | "active"
        | "degraded"
        | "offline"
      entity_alias_type:
        | "name"
        | "ticker"
        | "lei"
        | "registry_id"
        | "iso_code"
        | "fips"
        | "osm_id"
        | "abbreviation"
        | "acronym"
        | "isin"
        | "cusip"
        | "duns"
      entity_link_type:
        | "subsidiary"
        | "parent"
        | "headquartered_in"
        | "operates_in"
        | "trades_in"
        | "supplies"
        | "competes_with"
        | "regulates"
        | "member_of"
        | "borders"
        | "capital_of"
      entity_type:
        | "company"
        | "country"
        | "city"
        | "person"
        | "asset"
        | "product"
        | "event"
        | "policy"
        | "sector"
        | "commodity"
        | "territory"
      health_risk_level: "minimal" | "low" | "moderate" | "high" | "critical"
      ledger_entry_type:
        | "ethics"
        | "sdg"
        | "finance"
        | "policy"
        | "crisis"
        | "compliance"
      log_level: "info" | "warning" | "error" | "critical" | "success"
      org_type: "government" | "ngo" | "agency" | "academic" | "private"
      signal_category:
        | "geopolitical"
        | "economic"
        | "financial_markets"
        | "central_banking"
        | "public_health"
        | "climate_disaster"
        | "energy"
        | "technology"
        | "cybersecurity"
        | "defense_conflict"
        | "legal_regulatory"
        | "supply_chain"
        | "elections"
        | "social_unrest"
        | "infrastructure"
        | "food_agriculture"
        | "water_hydrology"
        | "migration_displacement"
      signal_status:
        | "new"
        | "developing"
        | "confirmed"
        | "resolved"
        | "watchlist"
      sovereignty_status:
        | "sovereign_state"
        | "territory"
        | "disputed"
        | "aggregate"
        | "source_only"
        | "deprecated"
      stability_status:
        | "stable"
        | "fluctuating"
        | "stressed"
        | "critical"
        | "failure"
      threat_severity: "low" | "medium" | "high" | "critical"
      threat_type:
        | "cyber"
        | "physical"
        | "network"
        | "data_breach"
        | "intrusion"
        | "malware"
      trade_side: "buy" | "sell"
      trade_status: "pending" | "executed" | "failed" | "cancelled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      access_tier: ["public", "institutional", "administrative"],
      alert_level: ["stable", "monitoring", "warning", "critical", "emergency"],
      app_role: ["admin", "operator", "observer"],
      data_purpose: [
        "analytics",
        "reporting",
        "research",
        "crisis_response",
        "policy_making",
        "audit",
      ],
      division_status: [
        "optimal",
        "operational",
        "active",
        "degraded",
        "offline",
      ],
      entity_alias_type: [
        "name",
        "ticker",
        "lei",
        "registry_id",
        "iso_code",
        "fips",
        "osm_id",
        "abbreviation",
        "acronym",
        "isin",
        "cusip",
        "duns",
      ],
      entity_link_type: [
        "subsidiary",
        "parent",
        "headquartered_in",
        "operates_in",
        "trades_in",
        "supplies",
        "competes_with",
        "regulates",
        "member_of",
        "borders",
        "capital_of",
      ],
      entity_type: [
        "company",
        "country",
        "city",
        "person",
        "asset",
        "product",
        "event",
        "policy",
        "sector",
        "commodity",
        "territory",
      ],
      health_risk_level: ["minimal", "low", "moderate", "high", "critical"],
      ledger_entry_type: [
        "ethics",
        "sdg",
        "finance",
        "policy",
        "crisis",
        "compliance",
      ],
      log_level: ["info", "warning", "error", "critical", "success"],
      org_type: ["government", "ngo", "agency", "academic", "private"],
      signal_category: [
        "geopolitical",
        "economic",
        "financial_markets",
        "central_banking",
        "public_health",
        "climate_disaster",
        "energy",
        "technology",
        "cybersecurity",
        "defense_conflict",
        "legal_regulatory",
        "supply_chain",
        "elections",
        "social_unrest",
        "infrastructure",
        "food_agriculture",
        "water_hydrology",
        "migration_displacement",
      ],
      signal_status: [
        "new",
        "developing",
        "confirmed",
        "resolved",
        "watchlist",
      ],
      sovereignty_status: [
        "sovereign_state",
        "territory",
        "disputed",
        "aggregate",
        "source_only",
        "deprecated",
      ],
      stability_status: [
        "stable",
        "fluctuating",
        "stressed",
        "critical",
        "failure",
      ],
      threat_severity: ["low", "medium", "high", "critical"],
      threat_type: [
        "cyber",
        "physical",
        "network",
        "data_breach",
        "intrusion",
        "malware",
      ],
      trade_side: ["buy", "sell"],
      trade_status: ["pending", "executed", "failed", "cancelled"],
    },
  },
} as const
