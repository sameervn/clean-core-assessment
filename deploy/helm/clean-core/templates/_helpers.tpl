{{- define "cc.name" -}}{{ printf "%s-clean-core" .Release.Name | trunc 63 | trimSuffix "-" }}{{- end }}
{{- define "cc.sa" -}}{{ default (include "cc.name" .) .Values.serviceAccount.name }}{{- end }}
{{- define "cc.secret" -}}{{ if .Values.secret.create }}{{ include "cc.name" . }}{{ else }}{{ required "existingSecret is required" .Values.existingSecret }}{{ end }}{{- end }}
{{- define "cc.validate" -}}
{{- if or (not .Values.image.repository) (not .Values.image.tag) (eq .Values.image.tag "latest") }}{{ fail "Explicit image repository and non-latest tag required" }}{{ end }}
{{- $multiple := or .Values.autoscaling.enabled (gt (int .Values.replicaCount) 1) (gt (int (default "1" .Values.config.CC_API_WORKER_COUNT)) 1) }}
{{- if not (has (default "local" .Values.config.CC_HTTP_LIMITER) (list "local" "redis-rest")) }}{{ fail "CC_HTTP_LIMITER must be local or redis-rest" }}{{ end }}
{{- if $multiple }}
{{- if ne .Values.config.CC_HTTP_LIMITER "redis-rest" }}{{ fail "Multiple API processes/replicas require CC_HTTP_LIMITER=redis-rest" }}{{ end }}
{{- end }}
{{- if and $multiple (eq .Values.config.CC_AI_ENABLED "true") (ne .Values.config.CC_AI_LIMITER "redis-rest") }}{{ fail "Multiple AI replicas require redis-rest limiter" }}{{ end }}
{{- if eq .Values.config.CC_KNOWLEDGE_STORAGE "local" }}
{{- if or $multiple (not .Values.localStorage.enabled) }}{{ fail "Local storage requires a persistent volume and exactly one replica without HPA" }}{{ end }}
{{- else if .Values.localStorage.enabled }}{{ fail "Local volume requires local backend" }}{{ end }}
{{- if and .Values.migration.enabled (or (not .Values.migration.existingSecret) (not .Values.migration.serviceAccountName)) }}{{ fail "Migration hooks require pre-existing Secret and service account" }}{{ end }}
{{- if .Values.provisioning.enabled }}
{{- if or (not .Values.provisioning.existingSecret) (not .Values.provisioning.serviceAccountName) }}{{ fail "Provisioning requires a pre-existing operator Secret and service account" }}{{ end }}
{{- if or (eq .Values.provisioning.existingSecret (include "cc.secret" .)) (and .Values.runtimeEnvFile.enabled (eq .Values.provisioning.existingSecret .Values.runtimeEnvFile.existingSecret)) (and .Values.migration.enabled (or (eq .Values.provisioning.existingSecret .Values.migration.existingSecret) (and .Values.migration.runtimeEnvFile.enabled (eq .Values.provisioning.existingSecret .Values.migration.runtimeEnvFile.existingSecret)))) }}{{ fail "Provisioning Secret must be separate from runtime and migration Secrets" }}{{ end }}
{{- if ne .Values.config.CC_SCHEMA_BOOTSTRAP "false" }}{{ fail "Operator provisioning requires CC_SCHEMA_BOOTSTRAP=false on the API" }}{{ end }}
{{- if or (not (regexMatch "^[a-z_][a-z0-9_]{0,62}$" .Values.provisioning.projectOwnerRole)) (not (regexMatch "^[a-z_][a-z0-9_]{0,62}$" .Values.provisioning.projectRuntimeRole)) (eq .Values.provisioning.projectOwnerRole .Values.provisioning.projectRuntimeRole) }}{{ fail "Provisioning owner/runtime roles must be valid distinct PostgreSQL roles" }}{{ end }}
{{- if and .Values.migration.enabled (or (ne .Values.provisioning.projectOwnerRole .Values.migration.projectOwnerRole) (ne .Values.provisioning.projectRuntimeRole .Values.migration.projectRuntimeRole)) }}{{ fail "Migration and provisioning owner/runtime roles must match" }}{{ end }}
{{- end }}
{{- if hasKey .Values.config "DATABASE_URL" }}{{ fail "DATABASE_URL must be injected through a Secret" }}{{ end }}
{{- range $key := list "SESSION_SECRET" "CC_BOOTSTRAP_PASSWORD" "CC_AI_API_KEY" "AI_GATEWAY_CLIENT_SECRET" "CC_AI_LIMITER_TOKEN" "CC_HTTP_LIMITER_TOKEN" "AWS_SECRET_ACCESS_KEY" "AWS_SESSION_TOKEN" "AZURE_CLIENT_SECRET" }}
{{- if hasKey $.Values.config $key }}{{ fail (printf "%s must be injected through a Secret" $key) }}{{ end }}
{{- end }}
{{- end }}
{{- define "cc.dbEnv" -}}
{{- if not .Values.runtimeEnvFile.enabled }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ include "cc.secret" . }}
      key: {{ .Values.databaseSecretKey }}
{{- end }}
{{- if .Values.databaseCA.configMap }}
- name: CC_DB_CA_FILE
  value: /etc/db-ca/ca.pem
{{- end }}
{{- end }}
