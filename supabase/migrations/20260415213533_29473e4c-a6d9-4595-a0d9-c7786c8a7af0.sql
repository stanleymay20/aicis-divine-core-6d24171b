
UPDATE adi_decisions SET domain = 'disaster_response' WHERE domain IN ('Disaster Response', 'Disaster Response / Geopolitical Stability', 'Disaster Response/Geopolitical Stability', 'Disaster Response / Intelligence', 'disaster_management', 'disaster_response_intelligence', 'humanitarian_disaster_response');
UPDATE adi_decisions SET domain = 'crisis_management' WHERE domain IN ('Crisis Management');
UPDATE adi_decisions SET domain = 'public_health' WHERE domain IN ('public_health_crisis', 'public_health_emergency_management', 'public_health_intelligence', 'public_health_security', 'public_health_humanitarian_response', 'health_security', 'National Security/Health Security');
UPDATE adi_decisions SET domain = 'humanitarian' WHERE domain IN ('humanitarian_response', 'humanitarian_aid');
UPDATE adi_decisions SET domain = 'geopolitical' WHERE domain IN ('geopolitical_stability', 'geopolitical_instability_humanitarian_crisis');

UPDATE decision_outcome_log SET domain = 'disaster_response' WHERE domain IN ('Disaster Response', 'Disaster Response / Geopolitical Stability', 'Disaster Response/Geopolitical Stability', 'Disaster Response / Intelligence', 'disaster_management', 'disaster_response_intelligence', 'humanitarian_disaster_response');
UPDATE decision_outcome_log SET domain = 'crisis_management' WHERE domain IN ('Crisis Management');
UPDATE decision_outcome_log SET domain = 'public_health' WHERE domain IN ('public_health_crisis', 'public_health_emergency_management', 'public_health_intelligence', 'public_health_security', 'public_health_humanitarian_response', 'health_security', 'National Security/Health Security');
UPDATE decision_outcome_log SET domain = 'humanitarian' WHERE domain IN ('humanitarian_response', 'humanitarian_aid');
UPDATE decision_outcome_log SET domain = 'geopolitical' WHERE domain IN ('geopolitical_stability', 'geopolitical_instability_humanitarian_crisis');
