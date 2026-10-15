import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AiLimiterHealth, AssessmentAiStatus, AssessmentContext, AssessmentExplanation, AssessmentExplanationInput, AssessmentInput, AssessmentResult, DemoResult, EvidenceRecord, EvidenceUpload, GetAiLimiterHealth503, HealthStatus, ListLocalUsers200, LocalSession, LocalUserEnvelope, LoginInput, PasswordChangeInput, PasswordResetInput, PermissionCheckInput, UserCreationInput, UserUpdateInput } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getGetLocalSessionUrl: () => string;
export declare const getLocalSession: (options?: Parameters<typeof customFetch>[1]) => Promise<LocalSession>;
export declare const getGetLocalSessionQueryKey: () => readonly ["/api/auth/me"];
export declare const getGetLocalSessionQueryOptions: <TData = Awaited<ReturnType<typeof getLocalSession>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getLocalSession>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getLocalSession>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetLocalSessionQueryResult = NonNullable<Awaited<ReturnType<typeof getLocalSession>>>;
export type GetLocalSessionQueryError = ErrorType<unknown>;
export declare function useGetLocalSession<TData = Awaited<ReturnType<typeof getLocalSession>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getLocalSession>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getLoginLocalUserUrl: () => string;
export declare const loginLocalUser: (loginInput: LoginInput, options?: Parameters<typeof customFetch>[1]) => Promise<LocalSession>;
export declare const getLoginLocalUserMutationKey: () => readonly ["loginLocalUser"];
export declare const getLoginLocalUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof loginLocalUser>>, TError, LoginLocalUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof loginLocalUser>>, TError, LoginLocalUserMutationVariables, TContext>;
export type LoginLocalUserMutationResult = NonNullable<Awaited<ReturnType<typeof loginLocalUser>>>;
export type LoginLocalUserMutationBody = BodyType<LoginInput>;
export type LoginLocalUserMutationError = ErrorType<unknown>;
export type LoginLocalUserMutationVariables = {
    data: BodyType<LoginInput>;
};
export declare const useLoginLocalUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof loginLocalUser>>, TError, LoginLocalUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof loginLocalUser>>, TError, LoginLocalUserMutationVariables, TContext>;
export declare const getLogoutLocalUserUrl: () => string;
export declare const logoutLocalUser: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getLogoutLocalUserMutationKey: () => readonly ["logoutLocalUser"];
export declare const getLogoutLocalUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logoutLocalUser>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof logoutLocalUser>>, TError, void, TContext>;
export type LogoutLocalUserMutationResult = NonNullable<Awaited<ReturnType<typeof logoutLocalUser>>>;
export type LogoutLocalUserMutationError = ErrorType<unknown>;
export declare const useLogoutLocalUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof logoutLocalUser>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof logoutLocalUser>>, TError, void, TContext>;
export declare const getChangeLocalPasswordUrl: () => string;
export declare const changeLocalPassword: (passwordChangeInput: PasswordChangeInput, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getChangeLocalPasswordMutationKey: () => readonly ["changeLocalPassword"];
export declare const getChangeLocalPasswordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changeLocalPassword>>, TError, ChangeLocalPasswordMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof changeLocalPassword>>, TError, ChangeLocalPasswordMutationVariables, TContext>;
export type ChangeLocalPasswordMutationResult = NonNullable<Awaited<ReturnType<typeof changeLocalPassword>>>;
export type ChangeLocalPasswordMutationBody = BodyType<PasswordChangeInput>;
export type ChangeLocalPasswordMutationError = ErrorType<unknown>;
export type ChangeLocalPasswordMutationVariables = {
    data: BodyType<PasswordChangeInput>;
};
export declare const useChangeLocalPassword: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changeLocalPassword>>, TError, ChangeLocalPasswordMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof changeLocalPassword>>, TError, ChangeLocalPasswordMutationVariables, TContext>;
export declare const getAuthorizeLocalActionUrl: () => string;
export declare const authorizeLocalAction: (permissionCheckInput: PermissionCheckInput, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getAuthorizeLocalActionMutationKey: () => readonly ["authorizeLocalAction"];
export declare const getAuthorizeLocalActionMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof authorizeLocalAction>>, TError, AuthorizeLocalActionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof authorizeLocalAction>>, TError, AuthorizeLocalActionMutationVariables, TContext>;
export type AuthorizeLocalActionMutationResult = NonNullable<Awaited<ReturnType<typeof authorizeLocalAction>>>;
export type AuthorizeLocalActionMutationBody = BodyType<PermissionCheckInput>;
export type AuthorizeLocalActionMutationError = ErrorType<void>;
export type AuthorizeLocalActionMutationVariables = {
    data: BodyType<PermissionCheckInput>;
};
export declare const useAuthorizeLocalAction: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof authorizeLocalAction>>, TError, AuthorizeLocalActionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof authorizeLocalAction>>, TError, AuthorizeLocalActionMutationVariables, TContext>;
export declare const getListLocalUsersUrl: () => string;
export declare const listLocalUsers: (options?: Parameters<typeof customFetch>[1]) => Promise<ListLocalUsers200>;
export declare const getListLocalUsersQueryKey: () => readonly ["/api/admin/users"];
export declare const getListLocalUsersQueryOptions: <TData = Awaited<ReturnType<typeof listLocalUsers>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listLocalUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listLocalUsers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListLocalUsersQueryResult = NonNullable<Awaited<ReturnType<typeof listLocalUsers>>>;
export type ListLocalUsersQueryError = ErrorType<unknown>;
export declare function useListLocalUsers<TData = Awaited<ReturnType<typeof listLocalUsers>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listLocalUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateLocalUserUrl: () => string;
export declare const createLocalUser: (userCreationInput: UserCreationInput, options?: Parameters<typeof customFetch>[1]) => Promise<LocalUserEnvelope>;
export declare const getCreateLocalUserMutationKey: () => readonly ["createLocalUser"];
export declare const getCreateLocalUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createLocalUser>>, TError, CreateLocalUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createLocalUser>>, TError, CreateLocalUserMutationVariables, TContext>;
export type CreateLocalUserMutationResult = NonNullable<Awaited<ReturnType<typeof createLocalUser>>>;
export type CreateLocalUserMutationBody = BodyType<UserCreationInput>;
export type CreateLocalUserMutationError = ErrorType<unknown>;
export type CreateLocalUserMutationVariables = {
    data: BodyType<UserCreationInput>;
};
export declare const useCreateLocalUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createLocalUser>>, TError, CreateLocalUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createLocalUser>>, TError, CreateLocalUserMutationVariables, TContext>;
export declare const getUpdateLocalUserUrl: (id: string) => string;
export declare const updateLocalUser: (id: string, userUpdateInput: UserUpdateInput, options?: Parameters<typeof customFetch>[1]) => Promise<LocalUserEnvelope>;
export declare const getUpdateLocalUserMutationKey: () => readonly ["updateLocalUser"];
export declare const getUpdateLocalUserMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateLocalUser>>, TError, UpdateLocalUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateLocalUser>>, TError, UpdateLocalUserMutationVariables, TContext>;
export type UpdateLocalUserMutationResult = NonNullable<Awaited<ReturnType<typeof updateLocalUser>>>;
export type UpdateLocalUserMutationBody = BodyType<UserUpdateInput>;
export type UpdateLocalUserMutationError = ErrorType<unknown>;
export type UpdateLocalUserMutationVariables = {
    id: string;
    data: BodyType<UserUpdateInput>;
};
export declare const useUpdateLocalUser: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateLocalUser>>, TError, UpdateLocalUserMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateLocalUser>>, TError, UpdateLocalUserMutationVariables, TContext>;
export declare const getResetLocalUserPasswordUrl: (id: string) => string;
export declare const resetLocalUserPassword: (id: string, passwordResetInput: PasswordResetInput, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getResetLocalUserPasswordMutationKey: () => readonly ["resetLocalUserPassword"];
export declare const getResetLocalUserPasswordMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetLocalUserPassword>>, TError, ResetLocalUserPasswordMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof resetLocalUserPassword>>, TError, ResetLocalUserPasswordMutationVariables, TContext>;
export type ResetLocalUserPasswordMutationResult = NonNullable<Awaited<ReturnType<typeof resetLocalUserPassword>>>;
export type ResetLocalUserPasswordMutationBody = BodyType<PasswordResetInput>;
export type ResetLocalUserPasswordMutationError = ErrorType<unknown>;
export type ResetLocalUserPasswordMutationVariables = {
    id: string;
    data: BodyType<PasswordResetInput>;
};
export declare const useResetLocalUserPassword: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetLocalUserPassword>>, TError, ResetLocalUserPasswordMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof resetLocalUserPassword>>, TError, ResetLocalUserPasswordMutationVariables, TContext>;
export declare const getReviewCleanCoreDemoUrl: () => string;
export declare const reviewCleanCoreDemo: (options?: Parameters<typeof customFetch>[1]) => Promise<DemoResult>;
export declare const getReviewCleanCoreDemoQueryKey: () => readonly ["/api/clean-core/review-demo"];
export declare const getReviewCleanCoreDemoQueryOptions: <TData = Awaited<ReturnType<typeof reviewCleanCoreDemo>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof reviewCleanCoreDemo>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof reviewCleanCoreDemo>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ReviewCleanCoreDemoQueryResult = NonNullable<Awaited<ReturnType<typeof reviewCleanCoreDemo>>>;
export type ReviewCleanCoreDemoQueryError = ErrorType<unknown>;
export declare function useReviewCleanCoreDemo<TData = Awaited<ReturnType<typeof reviewCleanCoreDemo>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof reviewCleanCoreDemo>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetAiLimiterHealthUrl: () => string;
/**
 * Gateway-authorized non-consuming limiter readiness and process-local metrics. Never calls the AI provider.
 */
export declare const getAiLimiterHealth: (options?: Parameters<typeof customFetch>[1]) => Promise<AiLimiterHealth>;
export declare const getGetAiLimiterHealthQueryKey: () => readonly ["/api/clean-core/ai/limiter-health"];
export declare const getGetAiLimiterHealthQueryOptions: <TData = Awaited<ReturnType<typeof getAiLimiterHealth>>, TError = ErrorType<void | GetAiLimiterHealth503>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAiLimiterHealth>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAiLimiterHealth>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAiLimiterHealthQueryResult = NonNullable<Awaited<ReturnType<typeof getAiLimiterHealth>>>;
export type GetAiLimiterHealthQueryError = ErrorType<void | GetAiLimiterHealth503>;
export declare function useGetAiLimiterHealth<TData = Awaited<ReturnType<typeof getAiLimiterHealth>>, TError = ErrorType<void | GetAiLimiterHealth503>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAiLimiterHealth>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetAssessmentAiStatusUrl: () => string;
export declare const getAssessmentAiStatus: (options?: Parameters<typeof customFetch>[1]) => Promise<AssessmentAiStatus>;
export declare const getGetAssessmentAiStatusQueryKey: () => readonly ["/api/clean-core/ai/status"];
export declare const getGetAssessmentAiStatusQueryOptions: <TData = Awaited<ReturnType<typeof getAssessmentAiStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAssessmentAiStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAssessmentAiStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAssessmentAiStatusQueryResult = NonNullable<Awaited<ReturnType<typeof getAssessmentAiStatus>>>;
export type GetAssessmentAiStatusQueryError = ErrorType<unknown>;
export declare function useGetAssessmentAiStatus<TData = Awaited<ReturnType<typeof getAssessmentAiStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAssessmentAiStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getExplainAssessmentUrl: () => string;
export declare const explainAssessment: (assessmentExplanationInput: AssessmentExplanationInput, options?: Parameters<typeof customFetch>[1]) => Promise<AssessmentExplanation>;
export declare const getExplainAssessmentMutationKey: () => readonly ["explainAssessment"];
export declare const getExplainAssessmentMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof explainAssessment>>, TError, ExplainAssessmentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof explainAssessment>>, TError, ExplainAssessmentMutationVariables, TContext>;
export type ExplainAssessmentMutationResult = NonNullable<Awaited<ReturnType<typeof explainAssessment>>>;
export type ExplainAssessmentMutationBody = BodyType<AssessmentExplanationInput>;
export type ExplainAssessmentMutationError = ErrorType<void>;
export type ExplainAssessmentMutationVariables = {
    data: BodyType<AssessmentExplanationInput>;
};
export declare const useExplainAssessment: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof explainAssessment>>, TError, ExplainAssessmentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof explainAssessment>>, TError, ExplainAssessmentMutationVariables, TContext>;
export declare const getLoadCleanCoreDemoUrl: () => string;
export declare const loadCleanCoreDemo: (assessmentContext: AssessmentContext, options?: Parameters<typeof customFetch>[1]) => Promise<DemoResult>;
export declare const getLoadCleanCoreDemoMutationKey: () => readonly ["loadCleanCoreDemo"];
export declare const getLoadCleanCoreDemoMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof loadCleanCoreDemo>>, TError, LoadCleanCoreDemoMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof loadCleanCoreDemo>>, TError, LoadCleanCoreDemoMutationVariables, TContext>;
export type LoadCleanCoreDemoMutationResult = NonNullable<Awaited<ReturnType<typeof loadCleanCoreDemo>>>;
export type LoadCleanCoreDemoMutationBody = BodyType<AssessmentContext>;
export type LoadCleanCoreDemoMutationError = ErrorType<unknown>;
export type LoadCleanCoreDemoMutationVariables = {
    data: BodyType<AssessmentContext>;
};
export declare const useLoadCleanCoreDemo: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof loadCleanCoreDemo>>, TError, LoadCleanCoreDemoMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof loadCleanCoreDemo>>, TError, LoadCleanCoreDemoMutationVariables, TContext>;
export declare const getRunCleanCoreAssessmentUrl: () => string;
export declare const runCleanCoreAssessment: (assessmentInput: AssessmentInput, options?: Parameters<typeof customFetch>[1]) => Promise<AssessmentResult>;
export declare const getRunCleanCoreAssessmentMutationKey: () => readonly ["runCleanCoreAssessment"];
export declare const getRunCleanCoreAssessmentMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runCleanCoreAssessment>>, TError, RunCleanCoreAssessmentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof runCleanCoreAssessment>>, TError, RunCleanCoreAssessmentMutationVariables, TContext>;
export type RunCleanCoreAssessmentMutationResult = NonNullable<Awaited<ReturnType<typeof runCleanCoreAssessment>>>;
export type RunCleanCoreAssessmentMutationBody = BodyType<AssessmentInput>;
export type RunCleanCoreAssessmentMutationError = ErrorType<unknown>;
export type RunCleanCoreAssessmentMutationVariables = {
    data: BodyType<AssessmentInput>;
};
export declare const useRunCleanCoreAssessment: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runCleanCoreAssessment>>, TError, RunCleanCoreAssessmentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof runCleanCoreAssessment>>, TError, RunCleanCoreAssessmentMutationVariables, TContext>;
export declare const getUploadCleanCoreEvidenceUrl: () => string;
export declare const uploadCleanCoreEvidence: (evidenceUpload: EvidenceUpload, options?: Parameters<typeof customFetch>[1]) => Promise<EvidenceRecord>;
export declare const getUploadCleanCoreEvidenceMutationKey: () => readonly ["uploadCleanCoreEvidence"];
export declare const getUploadCleanCoreEvidenceMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadCleanCoreEvidence>>, TError, UploadCleanCoreEvidenceMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof uploadCleanCoreEvidence>>, TError, UploadCleanCoreEvidenceMutationVariables, TContext>;
export type UploadCleanCoreEvidenceMutationResult = NonNullable<Awaited<ReturnType<typeof uploadCleanCoreEvidence>>>;
export type UploadCleanCoreEvidenceMutationBody = BodyType<EvidenceUpload>;
export type UploadCleanCoreEvidenceMutationError = ErrorType<unknown>;
export type UploadCleanCoreEvidenceMutationVariables = {
    data: BodyType<EvidenceUpload>;
};
export declare const useUploadCleanCoreEvidence: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadCleanCoreEvidence>>, TError, UploadCleanCoreEvidenceMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof uploadCleanCoreEvidence>>, TError, UploadCleanCoreEvidenceMutationVariables, TContext>;
export declare const getHealthCheckUrl: () => string;
/**
 * Returns server health status
 * @summary Health check
 */
export declare const healthCheck: (options?: Parameters<typeof customFetch>[1]) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export {};
//# sourceMappingURL=api.d.ts.map