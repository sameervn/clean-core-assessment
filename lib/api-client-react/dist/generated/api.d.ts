import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from '@tanstack/react-query';
import type { AccountAuditPage, AiLimiterHealth, ApprovalPage, ApprovedDownload, AssessmentAiStatus, AssessmentClient, AssessmentContext, AssessmentExplanation, AssessmentInput, AssessmentResult, ClientNameInput, ClientProject, ClientProjectCatalog, ClientProjectInput, CompanyTemplateUpload, DemoResult, DisconnectSharedGithubParams, DownloadWordTemplateSampleParams, EvidenceRecord, EvidenceUpload, GetAiLimiterHealth503, GetSharedAssessment200, GetWorkspaceReviewParams, GithubConnectionCheckInput, GithubConnectionCheckResult, GithubConnectionInput, GithubConnectionStatus, HealthStatus, KnowledgeAiConsent, KnowledgeAiRequest, KnowledgeCleanupInput, KnowledgeCleanupReport, KnowledgeCleanupStatus, KnowledgeDetail, KnowledgeDocument, KnowledgeList, KnowledgePreview, KnowledgeUpload, KnowledgeUploadTicket, KnowledgeVersion, ListAccountAuditParams, ListKnowledgeParams, ListLocalUsers200, ListReportTemplates200, ListReviewNotificationsParams, ListSharedApprovalsParams, ListSharedAssessments200, LocalSession, LocalUserEnvelope, LoginInput, PasswordChangeInput, PasswordResetInput, PermissionCheckInput, ProjectMemberDirectory, ProjectMemberInput, ProjectProvisioningInput, ProjectSourceConfirmation, ProjectSourceImport, ProjectSourceSelection, PublishSharedAssessment200, ReadSharedSourceParams, ReviewNotificationPage, ReviewNotificationPreference, SharedAction, SharedAssignment, SharedEdit, SharedEntityEnvelope, SharedGithubFilesParams, SharedMembership, SharedPublish, SharedSourceMapping, SharedSourceUpload, SharedVersion, StartWordTemplateUpload200, UserCreationInput, UserUpdateInput, WordDeleteInput, WordPreviewInput, WordRenderInput, WordTemplate, WordUpdateInput, WordUploadInput, WorkspaceReviewContext, WorkspaceReviewInput, WorkspaceReviewResult } from './api.schemas';
import { customFetch } from '../custom-fetch';
import type { ErrorType, BodyType } from '../custom-fetch';
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
export declare const getListClientProjectsUrl: () => string;
export declare const listClientProjects: (options?: Parameters<typeof customFetch>[1]) => Promise<ClientProjectCatalog>;
export declare const getListClientProjectsQueryKey: () => readonly ["/api/client-projects"];
export declare const getListClientProjectsQueryOptions: <TData = Awaited<ReturnType<typeof listClientProjects>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listClientProjects>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listClientProjects>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListClientProjectsQueryResult = NonNullable<Awaited<ReturnType<typeof listClientProjects>>>;
export type ListClientProjectsQueryError = ErrorType<unknown>;
export declare function useListClientProjects<TData = Awaited<ReturnType<typeof listClientProjects>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listClientProjects>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCreateAssessmentClientUrl: () => string;
export declare const createAssessmentClient: (clientNameInput: ClientNameInput, options?: Parameters<typeof customFetch>[1]) => Promise<AssessmentClient>;
export declare const getCreateAssessmentClientMutationKey: () => readonly ["createAssessmentClient"];
export declare const getCreateAssessmentClientMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAssessmentClient>>, TError, CreateAssessmentClientMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createAssessmentClient>>, TError, CreateAssessmentClientMutationVariables, TContext>;
export type CreateAssessmentClientMutationResult = NonNullable<Awaited<ReturnType<typeof createAssessmentClient>>>;
export type CreateAssessmentClientMutationBody = BodyType<ClientNameInput>;
export type CreateAssessmentClientMutationError = ErrorType<unknown>;
export type CreateAssessmentClientMutationVariables = {
    data: BodyType<ClientNameInput>;
};
export declare const useCreateAssessmentClient: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAssessmentClient>>, TError, CreateAssessmentClientMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createAssessmentClient>>, TError, CreateAssessmentClientMutationVariables, TContext>;
export declare const getCreateClientProjectUrl: () => string;
export declare const createClientProject: (clientProjectInput: ClientProjectInput, options?: Parameters<typeof customFetch>[1]) => Promise<ClientProject>;
export declare const getCreateClientProjectMutationKey: () => readonly ["createClientProject"];
export declare const getCreateClientProjectMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createClientProject>>, TError, CreateClientProjectMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createClientProject>>, TError, CreateClientProjectMutationVariables, TContext>;
export type CreateClientProjectMutationResult = NonNullable<Awaited<ReturnType<typeof createClientProject>>>;
export type CreateClientProjectMutationBody = BodyType<ClientProjectInput>;
export type CreateClientProjectMutationError = ErrorType<unknown>;
export type CreateClientProjectMutationVariables = {
    data: BodyType<ClientProjectInput>;
};
export declare const useCreateClientProject: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createClientProject>>, TError, CreateClientProjectMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createClientProject>>, TError, CreateClientProjectMutationVariables, TContext>;
export declare const getUpdateClientProjectUrl: (projectId: string) => string;
export declare const updateClientProject: (projectId: string, clientProjectInput: ClientProjectInput, options?: Parameters<typeof customFetch>[1]) => Promise<ClientProject>;
export declare const getUpdateClientProjectMutationKey: () => readonly ["updateClientProject"];
export declare const getUpdateClientProjectMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateClientProject>>, TError, UpdateClientProjectMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateClientProject>>, TError, UpdateClientProjectMutationVariables, TContext>;
export type UpdateClientProjectMutationResult = NonNullable<Awaited<ReturnType<typeof updateClientProject>>>;
export type UpdateClientProjectMutationBody = BodyType<ClientProjectInput>;
export type UpdateClientProjectMutationError = ErrorType<unknown>;
export type UpdateClientProjectMutationVariables = {
    projectId: string;
    data: BodyType<ClientProjectInput>;
};
export declare const useUpdateClientProject: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateClientProject>>, TError, UpdateClientProjectMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateClientProject>>, TError, UpdateClientProjectMutationVariables, TContext>;
export declare const getChangeProjectProvisioningUrl: (projectId: string) => string;
export declare const changeProjectProvisioning: (projectId: string, projectProvisioningInput: ProjectProvisioningInput, options?: Parameters<typeof customFetch>[1]) => Promise<ClientProject>;
export declare const getChangeProjectProvisioningMutationKey: () => readonly ["changeProjectProvisioning"];
export declare const getChangeProjectProvisioningMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changeProjectProvisioning>>, TError, ChangeProjectProvisioningMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof changeProjectProvisioning>>, TError, ChangeProjectProvisioningMutationVariables, TContext>;
export type ChangeProjectProvisioningMutationResult = NonNullable<Awaited<ReturnType<typeof changeProjectProvisioning>>>;
export type ChangeProjectProvisioningMutationBody = BodyType<ProjectProvisioningInput>;
export type ChangeProjectProvisioningMutationError = ErrorType<void>;
export type ChangeProjectProvisioningMutationVariables = {
    projectId: string;
    data: BodyType<ProjectProvisioningInput>;
};
export declare const useChangeProjectProvisioning: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof changeProjectProvisioning>>, TError, ChangeProjectProvisioningMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof changeProjectProvisioning>>, TError, ChangeProjectProvisioningMutationVariables, TContext>;
export declare const getGetClientProjectMembersUrl: (projectId: string) => string;
export declare const getClientProjectMembers: (projectId: string, options?: Parameters<typeof customFetch>[1]) => Promise<ProjectMemberDirectory>;
export declare const getGetClientProjectMembersQueryKey: (projectId: string) => readonly [`/api/client-projects/projects/${string}/members`];
export declare const getGetClientProjectMembersQueryOptions: <TData = Awaited<ReturnType<typeof getClientProjectMembers>>, TError = ErrorType<unknown>>(projectId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getClientProjectMembers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getClientProjectMembers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetClientProjectMembersQueryResult = NonNullable<Awaited<ReturnType<typeof getClientProjectMembers>>>;
export type GetClientProjectMembersQueryError = ErrorType<unknown>;
export declare function useGetClientProjectMembers<TData = Awaited<ReturnType<typeof getClientProjectMembers>>, TError = ErrorType<unknown>>(projectId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getClientProjectMembers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateClientProjectMemberUrl: (projectId: string) => string;
export declare const updateClientProjectMember: (projectId: string, projectMemberInput: ProjectMemberInput, options?: Parameters<typeof customFetch>[1]) => Promise<ProjectMemberDirectory>;
export declare const getUpdateClientProjectMemberMutationKey: () => readonly ["updateClientProjectMember"];
export declare const getUpdateClientProjectMemberMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateClientProjectMember>>, TError, UpdateClientProjectMemberMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateClientProjectMember>>, TError, UpdateClientProjectMemberMutationVariables, TContext>;
export type UpdateClientProjectMemberMutationResult = NonNullable<Awaited<ReturnType<typeof updateClientProjectMember>>>;
export type UpdateClientProjectMemberMutationBody = BodyType<ProjectMemberInput>;
export type UpdateClientProjectMemberMutationError = ErrorType<unknown>;
export type UpdateClientProjectMemberMutationVariables = {
    projectId: string;
    data: BodyType<ProjectMemberInput>;
};
export declare const useUpdateClientProjectMember: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateClientProjectMember>>, TError, UpdateClientProjectMemberMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateClientProjectMember>>, TError, UpdateClientProjectMemberMutationVariables, TContext>;
export declare const getGetReviewNotificationPreferencesUrl: () => string;
export declare const getReviewNotificationPreferences: (options?: Parameters<typeof customFetch>[1]) => Promise<ReviewNotificationPreference>;
export declare const getGetReviewNotificationPreferencesQueryKey: () => readonly ["/api/shared-assessments/notifications/preferences"];
export declare const getGetReviewNotificationPreferencesQueryOptions: <TData = Awaited<ReturnType<typeof getReviewNotificationPreferences>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReviewNotificationPreferences>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getReviewNotificationPreferences>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetReviewNotificationPreferencesQueryResult = NonNullable<Awaited<ReturnType<typeof getReviewNotificationPreferences>>>;
export type GetReviewNotificationPreferencesQueryError = ErrorType<unknown>;
export declare function useGetReviewNotificationPreferences<TData = Awaited<ReturnType<typeof getReviewNotificationPreferences>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReviewNotificationPreferences>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateReviewNotificationPreferencesUrl: () => string;
export declare const updateReviewNotificationPreferences: (reviewNotificationPreference: ReviewNotificationPreference, options?: Parameters<typeof customFetch>[1]) => Promise<ReviewNotificationPreference>;
export declare const getUpdateReviewNotificationPreferencesMutationKey: () => readonly ["updateReviewNotificationPreferences"];
export declare const getUpdateReviewNotificationPreferencesMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateReviewNotificationPreferences>>, TError, UpdateReviewNotificationPreferencesMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateReviewNotificationPreferences>>, TError, UpdateReviewNotificationPreferencesMutationVariables, TContext>;
export type UpdateReviewNotificationPreferencesMutationResult = NonNullable<Awaited<ReturnType<typeof updateReviewNotificationPreferences>>>;
export type UpdateReviewNotificationPreferencesMutationBody = BodyType<ReviewNotificationPreference>;
export type UpdateReviewNotificationPreferencesMutationError = ErrorType<unknown>;
export type UpdateReviewNotificationPreferencesMutationVariables = {
    data: BodyType<ReviewNotificationPreference>;
};
export declare const useUpdateReviewNotificationPreferences: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateReviewNotificationPreferences>>, TError, UpdateReviewNotificationPreferencesMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateReviewNotificationPreferences>>, TError, UpdateReviewNotificationPreferencesMutationVariables, TContext>;
export declare const getListReviewNotificationsUrl: (params?: ListReviewNotificationsParams) => string;
export declare const listReviewNotifications: (params?: ListReviewNotificationsParams, options?: Parameters<typeof customFetch>[1]) => Promise<ReviewNotificationPage>;
export declare const getListReviewNotificationsQueryKey: (params?: ListReviewNotificationsParams) => readonly ["/api/shared-assessments/notifications", ...ListReviewNotificationsParams[]];
export declare const getListReviewNotificationsQueryOptions: <TData = Awaited<ReturnType<typeof listReviewNotifications>>, TError = ErrorType<void>>(params?: ListReviewNotificationsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReviewNotifications>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listReviewNotifications>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListReviewNotificationsQueryResult = NonNullable<Awaited<ReturnType<typeof listReviewNotifications>>>;
export type ListReviewNotificationsQueryError = ErrorType<void>;
export declare function useListReviewNotifications<TData = Awaited<ReturnType<typeof listReviewNotifications>>, TError = ErrorType<void>>(params?: ListReviewNotificationsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReviewNotifications>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getReadReviewNotificationUrl: (notificationId: string) => string;
export declare const readReviewNotification: (notificationId: string, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getReadReviewNotificationMutationKey: () => readonly ["readReviewNotification"];
export declare const getReadReviewNotificationMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof readReviewNotification>>, TError, ReadReviewNotificationMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof readReviewNotification>>, TError, ReadReviewNotificationMutationVariables, TContext>;
export type ReadReviewNotificationMutationResult = NonNullable<Awaited<ReturnType<typeof readReviewNotification>>>;
export type ReadReviewNotificationMutationError = ErrorType<void>;
export type ReadReviewNotificationMutationVariables = {
    notificationId: string;
};
export declare const useReadReviewNotification: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof readReviewNotification>>, TError, ReadReviewNotificationMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof readReviewNotification>>, TError, ReadReviewNotificationMutationVariables, TContext>;
export declare const getListSharedAssessmentsUrl: () => string;
export declare const listSharedAssessments: (options?: Parameters<typeof customFetch>[1]) => Promise<ListSharedAssessments200>;
export declare const getListSharedAssessmentsQueryKey: () => readonly ["/api/shared-assessments"];
export declare const getListSharedAssessmentsQueryOptions: <TData = Awaited<ReturnType<typeof listSharedAssessments>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSharedAssessments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listSharedAssessments>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListSharedAssessmentsQueryResult = NonNullable<Awaited<ReturnType<typeof listSharedAssessments>>>;
export type ListSharedAssessmentsQueryError = ErrorType<unknown>;
export declare function useListSharedAssessments<TData = Awaited<ReturnType<typeof listSharedAssessments>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSharedAssessments>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getPublishSharedAssessmentUrl: () => string;
export declare const publishSharedAssessment: (sharedPublish: SharedPublish, options?: Parameters<typeof customFetch>[1]) => Promise<PublishSharedAssessment200>;
export declare const getPublishSharedAssessmentMutationKey: () => readonly ["publishSharedAssessment"];
export declare const getPublishSharedAssessmentMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof publishSharedAssessment>>, TError, PublishSharedAssessmentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof publishSharedAssessment>>, TError, PublishSharedAssessmentMutationVariables, TContext>;
export type PublishSharedAssessmentMutationResult = NonNullable<Awaited<ReturnType<typeof publishSharedAssessment>>>;
export type PublishSharedAssessmentMutationBody = BodyType<SharedPublish>;
export type PublishSharedAssessmentMutationError = ErrorType<unknown>;
export type PublishSharedAssessmentMutationVariables = {
    data: BodyType<SharedPublish>;
};
export declare const usePublishSharedAssessment: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof publishSharedAssessment>>, TError, PublishSharedAssessmentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof publishSharedAssessment>>, TError, PublishSharedAssessmentMutationVariables, TContext>;
export declare const getGetWorkspaceReviewUrl: (params: GetWorkspaceReviewParams) => string;
export declare const getWorkspaceReview: (params: GetWorkspaceReviewParams, options?: Parameters<typeof customFetch>[1]) => Promise<WorkspaceReviewContext>;
export declare const getGetWorkspaceReviewQueryKey: (params?: GetWorkspaceReviewParams) => readonly ["/api/shared-assessments/workspace-review", ...GetWorkspaceReviewParams[]];
export declare const getGetWorkspaceReviewQueryOptions: <TData = Awaited<ReturnType<typeof getWorkspaceReview>>, TError = ErrorType<unknown>>(params: GetWorkspaceReviewParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getWorkspaceReview>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getWorkspaceReview>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetWorkspaceReviewQueryResult = NonNullable<Awaited<ReturnType<typeof getWorkspaceReview>>>;
export type GetWorkspaceReviewQueryError = ErrorType<unknown>;
export declare function useGetWorkspaceReview<TData = Awaited<ReturnType<typeof getWorkspaceReview>>, TError = ErrorType<unknown>>(params: GetWorkspaceReviewParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getWorkspaceReview>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getPrepareWorkspaceReviewUrl: () => string;
export declare const prepareWorkspaceReview: (workspaceReviewInput: WorkspaceReviewInput, options?: Parameters<typeof customFetch>[1]) => Promise<WorkspaceReviewResult>;
export declare const getPrepareWorkspaceReviewMutationKey: () => readonly ["prepareWorkspaceReview"];
export declare const getPrepareWorkspaceReviewMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof prepareWorkspaceReview>>, TError, PrepareWorkspaceReviewMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof prepareWorkspaceReview>>, TError, PrepareWorkspaceReviewMutationVariables, TContext>;
export type PrepareWorkspaceReviewMutationResult = NonNullable<Awaited<ReturnType<typeof prepareWorkspaceReview>>>;
export type PrepareWorkspaceReviewMutationBody = BodyType<WorkspaceReviewInput>;
export type PrepareWorkspaceReviewMutationError = ErrorType<void>;
export type PrepareWorkspaceReviewMutationVariables = {
    data: BodyType<WorkspaceReviewInput>;
};
export declare const usePrepareWorkspaceReview: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof prepareWorkspaceReview>>, TError, PrepareWorkspaceReviewMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof prepareWorkspaceReview>>, TError, PrepareWorkspaceReviewMutationVariables, TContext>;
export declare const getSharedAssessmentAdministrationUrl: () => string;
export declare const sharedAssessmentAdministration: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getSharedAssessmentAdministrationQueryKey: () => readonly ["/api/shared-assessments/administration"];
export declare const getSharedAssessmentAdministrationQueryOptions: <TData = Awaited<ReturnType<typeof sharedAssessmentAdministration>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof sharedAssessmentAdministration>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof sharedAssessmentAdministration>>, TError, TData> & {
    queryKey: QueryKey;
};
export type SharedAssessmentAdministrationQueryResult = NonNullable<Awaited<ReturnType<typeof sharedAssessmentAdministration>>>;
export type SharedAssessmentAdministrationQueryError = ErrorType<unknown>;
export declare function useSharedAssessmentAdministration<TData = Awaited<ReturnType<typeof sharedAssessmentAdministration>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof sharedAssessmentAdministration>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getGetSharedAssessmentUrl: (id: string) => string;
export declare const getSharedAssessment: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<GetSharedAssessment200>;
export declare const getGetSharedAssessmentQueryKey: (id: string) => readonly [`/api/shared-assessments/${string}`];
export declare const getGetSharedAssessmentQueryOptions: <TData = Awaited<ReturnType<typeof getSharedAssessment>>, TError = ErrorType<unknown>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSharedAssessment>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSharedAssessment>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSharedAssessmentQueryResult = NonNullable<Awaited<ReturnType<typeof getSharedAssessment>>>;
export type GetSharedAssessmentQueryError = ErrorType<unknown>;
export declare function useGetSharedAssessment<TData = Awaited<ReturnType<typeof getSharedAssessment>>, TError = ErrorType<unknown>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSharedAssessment>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUpdateSharedMembershipUrl: (id: string) => string;
export declare const updateSharedMembership: (id: string, sharedMembership: SharedMembership, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getUpdateSharedMembershipMutationKey: () => readonly ["updateSharedMembership"];
export declare const getUpdateSharedMembershipMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateSharedMembership>>, TError, UpdateSharedMembershipMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateSharedMembership>>, TError, UpdateSharedMembershipMutationVariables, TContext>;
export type UpdateSharedMembershipMutationResult = NonNullable<Awaited<ReturnType<typeof updateSharedMembership>>>;
export type UpdateSharedMembershipMutationBody = BodyType<SharedMembership>;
export type UpdateSharedMembershipMutationError = ErrorType<unknown>;
export type UpdateSharedMembershipMutationVariables = {
    id: string;
    data: BodyType<SharedMembership>;
};
export declare const useUpdateSharedMembership: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateSharedMembership>>, TError, UpdateSharedMembershipMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateSharedMembership>>, TError, UpdateSharedMembershipMutationVariables, TContext>;
export declare const getSaveSharedEntityUrl: (id: string) => string;
export declare const saveSharedEntity: (id: string, sharedEdit: SharedEdit, options?: Parameters<typeof customFetch>[1]) => Promise<SharedEntityEnvelope>;
export declare const getSaveSharedEntityMutationKey: () => readonly ["saveSharedEntity"];
export declare const getSaveSharedEntityMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveSharedEntity>>, TError, SaveSharedEntityMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof saveSharedEntity>>, TError, SaveSharedEntityMutationVariables, TContext>;
export type SaveSharedEntityMutationResult = NonNullable<Awaited<ReturnType<typeof saveSharedEntity>>>;
export type SaveSharedEntityMutationBody = BodyType<SharedEdit>;
export type SaveSharedEntityMutationError = ErrorType<void>;
export type SaveSharedEntityMutationVariables = {
    id: string;
    data: BodyType<SharedEdit>;
};
export declare const useSaveSharedEntity: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof saveSharedEntity>>, TError, SaveSharedEntityMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof saveSharedEntity>>, TError, SaveSharedEntityMutationVariables, TContext>;
export declare const getSharedReviewActionUrl: (id: string) => string;
export declare const sharedReviewAction: (id: string, sharedAction: SharedAction, options?: Parameters<typeof customFetch>[1]) => Promise<SharedEntityEnvelope>;
export declare const getSharedReviewActionMutationKey: () => readonly ["sharedReviewAction"];
export declare const getSharedReviewActionMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sharedReviewAction>>, TError, SharedReviewActionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof sharedReviewAction>>, TError, SharedReviewActionMutationVariables, TContext>;
export type SharedReviewActionMutationResult = NonNullable<Awaited<ReturnType<typeof sharedReviewAction>>>;
export type SharedReviewActionMutationBody = BodyType<SharedAction>;
export type SharedReviewActionMutationError = ErrorType<void>;
export type SharedReviewActionMutationVariables = {
    id: string;
    data: BodyType<SharedAction>;
};
export declare const useSharedReviewAction: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof sharedReviewAction>>, TError, SharedReviewActionMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof sharedReviewAction>>, TError, SharedReviewActionMutationVariables, TContext>;
export declare const getAssignSharedReviewerUrl: (id: string) => string;
export declare const assignSharedReviewer: (id: string, sharedAssignment: SharedAssignment, options?: Parameters<typeof customFetch>[1]) => Promise<SharedEntityEnvelope>;
export declare const getAssignSharedReviewerMutationKey: () => readonly ["assignSharedReviewer"];
export declare const getAssignSharedReviewerMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof assignSharedReviewer>>, TError, AssignSharedReviewerMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof assignSharedReviewer>>, TError, AssignSharedReviewerMutationVariables, TContext>;
export type AssignSharedReviewerMutationResult = NonNullable<Awaited<ReturnType<typeof assignSharedReviewer>>>;
export type AssignSharedReviewerMutationBody = BodyType<SharedAssignment>;
export type AssignSharedReviewerMutationError = ErrorType<unknown>;
export type AssignSharedReviewerMutationVariables = {
    id: string;
    data: BodyType<SharedAssignment>;
};
export declare const useAssignSharedReviewer: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof assignSharedReviewer>>, TError, AssignSharedReviewerMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof assignSharedReviewer>>, TError, AssignSharedReviewerMutationVariables, TContext>;
export declare const getSharedGithubStatusUrl: () => string;
export declare const sharedGithubStatus: (options?: Parameters<typeof customFetch>[1]) => Promise<GithubConnectionStatus>;
export declare const getSharedGithubStatusQueryKey: () => readonly ["/api/shared-assessments/github/status"];
export declare const getSharedGithubStatusQueryOptions: <TData = Awaited<ReturnType<typeof sharedGithubStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof sharedGithubStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof sharedGithubStatus>>, TError, TData> & {
    queryKey: QueryKey;
};
export type SharedGithubStatusQueryResult = NonNullable<Awaited<ReturnType<typeof sharedGithubStatus>>>;
export type SharedGithubStatusQueryError = ErrorType<unknown>;
export declare function useSharedGithubStatus<TData = Awaited<ReturnType<typeof sharedGithubStatus>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof sharedGithubStatus>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getCheckSharedGithubUrl: () => string;
export declare const checkSharedGithub: (githubConnectionCheckInput: GithubConnectionCheckInput, options?: Parameters<typeof customFetch>[1]) => Promise<GithubConnectionCheckResult>;
export declare const getCheckSharedGithubMutationKey: () => readonly ["checkSharedGithub"];
export declare const getCheckSharedGithubMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof checkSharedGithub>>, TError, CheckSharedGithubMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof checkSharedGithub>>, TError, CheckSharedGithubMutationVariables, TContext>;
export type CheckSharedGithubMutationResult = NonNullable<Awaited<ReturnType<typeof checkSharedGithub>>>;
export type CheckSharedGithubMutationBody = BodyType<GithubConnectionCheckInput>;
export type CheckSharedGithubMutationError = ErrorType<void>;
export type CheckSharedGithubMutationVariables = {
    data: BodyType<GithubConnectionCheckInput>;
};
export declare const useCheckSharedGithub: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof checkSharedGithub>>, TError, CheckSharedGithubMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof checkSharedGithub>>, TError, CheckSharedGithubMutationVariables, TContext>;
export declare const getConnectSharedGithubUrl: () => string;
export declare const connectSharedGithub: (githubConnectionInput: GithubConnectionInput, options?: Parameters<typeof customFetch>[1]) => Promise<GithubConnectionStatus>;
export declare const getConnectSharedGithubMutationKey: () => readonly ["connectSharedGithub"];
export declare const getConnectSharedGithubMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof connectSharedGithub>>, TError, ConnectSharedGithubMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof connectSharedGithub>>, TError, ConnectSharedGithubMutationVariables, TContext>;
export type ConnectSharedGithubMutationResult = NonNullable<Awaited<ReturnType<typeof connectSharedGithub>>>;
export type ConnectSharedGithubMutationBody = BodyType<GithubConnectionInput>;
export type ConnectSharedGithubMutationError = ErrorType<void>;
export type ConnectSharedGithubMutationVariables = {
    data: BodyType<GithubConnectionInput>;
};
export declare const useConnectSharedGithub: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof connectSharedGithub>>, TError, ConnectSharedGithubMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof connectSharedGithub>>, TError, ConnectSharedGithubMutationVariables, TContext>;
export declare const getDisconnectSharedGithubUrl: (params?: DisconnectSharedGithubParams) => string;
export declare const disconnectSharedGithub: (params?: DisconnectSharedGithubParams, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getDisconnectSharedGithubMutationKey: () => readonly ["disconnectSharedGithub"];
export declare const getDisconnectSharedGithubMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof disconnectSharedGithub>>, TError, DisconnectSharedGithubMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof disconnectSharedGithub>>, TError, DisconnectSharedGithubMutationVariables, TContext>;
export type DisconnectSharedGithubMutationResult = NonNullable<Awaited<ReturnType<typeof disconnectSharedGithub>>>;
export type DisconnectSharedGithubMutationError = ErrorType<unknown>;
export type DisconnectSharedGithubMutationVariables = {
    params?: DisconnectSharedGithubParams;
};
export declare const useDisconnectSharedGithub: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof disconnectSharedGithub>>, TError, DisconnectSharedGithubMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof disconnectSharedGithub>>, TError, DisconnectSharedGithubMutationVariables, TContext>;
export declare const getListProjectSourceImportsUrl: () => string;
export declare const listProjectSourceImports: (options?: Parameters<typeof customFetch>[1]) => Promise<ProjectSourceImport[]>;
export declare const getListProjectSourceImportsQueryKey: () => readonly ["/api/shared-assessments/github/imports"];
export declare const getListProjectSourceImportsQueryOptions: <TData = Awaited<ReturnType<typeof listProjectSourceImports>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectSourceImports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listProjectSourceImports>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListProjectSourceImportsQueryResult = NonNullable<Awaited<ReturnType<typeof listProjectSourceImports>>>;
export type ListProjectSourceImportsQueryError = ErrorType<unknown>;
export declare function useListProjectSourceImports<TData = Awaited<ReturnType<typeof listProjectSourceImports>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listProjectSourceImports>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getPreviewProjectSourceImportUrl: () => string;
export declare const previewProjectSourceImport: (projectSourceSelection: ProjectSourceSelection, options?: Parameters<typeof customFetch>[1]) => Promise<ProjectSourceImport>;
export declare const getPreviewProjectSourceImportMutationKey: () => readonly ["previewProjectSourceImport"];
export declare const getPreviewProjectSourceImportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof previewProjectSourceImport>>, TError, PreviewProjectSourceImportMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof previewProjectSourceImport>>, TError, PreviewProjectSourceImportMutationVariables, TContext>;
export type PreviewProjectSourceImportMutationResult = NonNullable<Awaited<ReturnType<typeof previewProjectSourceImport>>>;
export type PreviewProjectSourceImportMutationBody = BodyType<ProjectSourceSelection>;
export type PreviewProjectSourceImportMutationError = ErrorType<unknown>;
export type PreviewProjectSourceImportMutationVariables = {
    data: BodyType<ProjectSourceSelection>;
};
export declare const usePreviewProjectSourceImport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof previewProjectSourceImport>>, TError, PreviewProjectSourceImportMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof previewProjectSourceImport>>, TError, PreviewProjectSourceImportMutationVariables, TContext>;
export declare const getGetProjectSourceImportUrl: (id: string) => string;
export declare const getProjectSourceImport: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<ProjectSourceImport>;
export declare const getGetProjectSourceImportQueryKey: (id: string) => readonly [`/api/shared-assessments/github/imports/${string}`];
export declare const getGetProjectSourceImportQueryOptions: <TData = Awaited<ReturnType<typeof getProjectSourceImport>>, TError = ErrorType<unknown>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectSourceImport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getProjectSourceImport>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetProjectSourceImportQueryResult = NonNullable<Awaited<ReturnType<typeof getProjectSourceImport>>>;
export type GetProjectSourceImportQueryError = ErrorType<unknown>;
export declare function useGetProjectSourceImport<TData = Awaited<ReturnType<typeof getProjectSourceImport>>, TError = ErrorType<unknown>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getProjectSourceImport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getStartProjectSourceImportUrl: (id: string) => string;
export declare const startProjectSourceImport: (id: string, projectSourceConfirmation: ProjectSourceConfirmation, options?: Parameters<typeof customFetch>[1]) => Promise<ProjectSourceImport>;
export declare const getStartProjectSourceImportMutationKey: () => readonly ["startProjectSourceImport"];
export declare const getStartProjectSourceImportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startProjectSourceImport>>, TError, StartProjectSourceImportMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof startProjectSourceImport>>, TError, StartProjectSourceImportMutationVariables, TContext>;
export type StartProjectSourceImportMutationResult = NonNullable<Awaited<ReturnType<typeof startProjectSourceImport>>>;
export type StartProjectSourceImportMutationBody = BodyType<ProjectSourceConfirmation>;
export type StartProjectSourceImportMutationError = ErrorType<unknown>;
export type StartProjectSourceImportMutationVariables = {
    id: string;
    data: BodyType<ProjectSourceConfirmation>;
};
export declare const useStartProjectSourceImport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startProjectSourceImport>>, TError, StartProjectSourceImportMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof startProjectSourceImport>>, TError, StartProjectSourceImportMutationVariables, TContext>;
export declare const getCancelProjectSourceImportUrl: (id: string) => string;
export declare const cancelProjectSourceImport: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<ProjectSourceImport>;
export declare const getCancelProjectSourceImportMutationKey: () => readonly ["cancelProjectSourceImport"];
export declare const getCancelProjectSourceImportMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof cancelProjectSourceImport>>, TError, CancelProjectSourceImportMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof cancelProjectSourceImport>>, TError, CancelProjectSourceImportMutationVariables, TContext>;
export type CancelProjectSourceImportMutationResult = NonNullable<Awaited<ReturnType<typeof cancelProjectSourceImport>>>;
export type CancelProjectSourceImportMutationError = ErrorType<unknown>;
export type CancelProjectSourceImportMutationVariables = {
    id: string;
};
export declare const useCancelProjectSourceImport: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof cancelProjectSourceImport>>, TError, CancelProjectSourceImportMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof cancelProjectSourceImport>>, TError, CancelProjectSourceImportMutationVariables, TContext>;
export declare const getSharedGithubFilesUrl: (params: SharedGithubFilesParams) => string;
export declare const sharedGithubFiles: (params: SharedGithubFilesParams, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getSharedGithubFilesQueryKey: (params?: SharedGithubFilesParams) => readonly ["/api/shared-assessments/github/files", ...SharedGithubFilesParams[]];
export declare const getSharedGithubFilesQueryOptions: <TData = Awaited<ReturnType<typeof sharedGithubFiles>>, TError = ErrorType<unknown>>(params: SharedGithubFilesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof sharedGithubFiles>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof sharedGithubFiles>>, TError, TData> & {
    queryKey: QueryKey;
};
export type SharedGithubFilesQueryResult = NonNullable<Awaited<ReturnType<typeof sharedGithubFiles>>>;
export type SharedGithubFilesQueryError = ErrorType<unknown>;
export declare function useSharedGithubFiles<TData = Awaited<ReturnType<typeof sharedGithubFiles>>, TError = ErrorType<unknown>>(params: SharedGithubFilesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof sharedGithubFiles>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getMapSharedGithubSourceUrl: (id: string) => string;
export declare const mapSharedGithubSource: (id: string, sharedSourceMapping: SharedSourceMapping, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getMapSharedGithubSourceMutationKey: () => readonly ["mapSharedGithubSource"];
export declare const getMapSharedGithubSourceMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof mapSharedGithubSource>>, TError, MapSharedGithubSourceMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof mapSharedGithubSource>>, TError, MapSharedGithubSourceMutationVariables, TContext>;
export type MapSharedGithubSourceMutationResult = NonNullable<Awaited<ReturnType<typeof mapSharedGithubSource>>>;
export type MapSharedGithubSourceMutationBody = BodyType<SharedSourceMapping>;
export type MapSharedGithubSourceMutationError = ErrorType<unknown>;
export type MapSharedGithubSourceMutationVariables = {
    id: string;
    data: BodyType<SharedSourceMapping>;
};
export declare const useMapSharedGithubSource: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof mapSharedGithubSource>>, TError, MapSharedGithubSourceMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof mapSharedGithubSource>>, TError, MapSharedGithubSourceMutationVariables, TContext>;
export declare const getUploadSharedSourceUrl: (id: string) => string;
export declare const uploadSharedSource: (id: string, sharedSourceUpload: SharedSourceUpload, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getUploadSharedSourceMutationKey: () => readonly ["uploadSharedSource"];
export declare const getUploadSharedSourceMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadSharedSource>>, TError, UploadSharedSourceMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof uploadSharedSource>>, TError, UploadSharedSourceMutationVariables, TContext>;
export type UploadSharedSourceMutationResult = NonNullable<Awaited<ReturnType<typeof uploadSharedSource>>>;
export type UploadSharedSourceMutationBody = BodyType<SharedSourceUpload>;
export type UploadSharedSourceMutationError = ErrorType<void>;
export type UploadSharedSourceMutationVariables = {
    id: string;
    data: BodyType<SharedSourceUpload>;
};
export declare const useUploadSharedSource: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadSharedSource>>, TError, UploadSharedSourceMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof uploadSharedSource>>, TError, UploadSharedSourceMutationVariables, TContext>;
export declare const getReadSharedSourceUrl: (id: string, index: number, params?: ReadSharedSourceParams) => string;
export declare const readSharedSource: (id: string, index: number, params?: ReadSharedSourceParams, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getReadSharedSourceQueryKey: (id: string, index: number, params?: ReadSharedSourceParams) => readonly [`/api/shared-assessments/entities/${string}/source/${number}`, ...ReadSharedSourceParams[]];
export declare const getReadSharedSourceQueryOptions: <TData = Awaited<ReturnType<typeof readSharedSource>>, TError = ErrorType<unknown>>(id: string, index: number, params?: ReadSharedSourceParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof readSharedSource>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof readSharedSource>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ReadSharedSourceQueryResult = NonNullable<Awaited<ReturnType<typeof readSharedSource>>>;
export type ReadSharedSourceQueryError = ErrorType<unknown>;
export declare function useReadSharedSource<TData = Awaited<ReturnType<typeof readSharedSource>>, TError = ErrorType<unknown>>(id: string, index: number, params?: ReadSharedSourceParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof readSharedSource>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getEvaluateSharedSourceUrl: (id: string) => string;
export declare const evaluateSharedSource: (id: string, sharedVersion: SharedVersion, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getEvaluateSharedSourceMutationKey: () => readonly ["evaluateSharedSource"];
export declare const getEvaluateSharedSourceMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof evaluateSharedSource>>, TError, EvaluateSharedSourceMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof evaluateSharedSource>>, TError, EvaluateSharedSourceMutationVariables, TContext>;
export type EvaluateSharedSourceMutationResult = NonNullable<Awaited<ReturnType<typeof evaluateSharedSource>>>;
export type EvaluateSharedSourceMutationBody = BodyType<SharedVersion>;
export type EvaluateSharedSourceMutationError = ErrorType<unknown>;
export type EvaluateSharedSourceMutationVariables = {
    id: string;
    data: BodyType<SharedVersion>;
};
export declare const useEvaluateSharedSource: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof evaluateSharedSource>>, TError, EvaluateSharedSourceMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof evaluateSharedSource>>, TError, EvaluateSharedSourceMutationVariables, TContext>;
export declare const getListCompanyTemplatesUrl: () => string;
export declare const listCompanyTemplates: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getListCompanyTemplatesQueryKey: () => readonly ["/api/shared-assessments/company-templates"];
export declare const getListCompanyTemplatesQueryOptions: <TData = Awaited<ReturnType<typeof listCompanyTemplates>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listCompanyTemplates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listCompanyTemplates>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListCompanyTemplatesQueryResult = NonNullable<Awaited<ReturnType<typeof listCompanyTemplates>>>;
export type ListCompanyTemplatesQueryError = ErrorType<unknown>;
export declare function useListCompanyTemplates<TData = Awaited<ReturnType<typeof listCompanyTemplates>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listCompanyTemplates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getUploadCompanyTemplateUrl: () => string;
export declare const uploadCompanyTemplate: (companyTemplateUpload: CompanyTemplateUpload, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getUploadCompanyTemplateMutationKey: () => readonly ["uploadCompanyTemplate"];
export declare const getUploadCompanyTemplateMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadCompanyTemplate>>, TError, UploadCompanyTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof uploadCompanyTemplate>>, TError, UploadCompanyTemplateMutationVariables, TContext>;
export type UploadCompanyTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof uploadCompanyTemplate>>>;
export type UploadCompanyTemplateMutationBody = BodyType<CompanyTemplateUpload>;
export type UploadCompanyTemplateMutationError = ErrorType<unknown>;
export type UploadCompanyTemplateMutationVariables = {
    data: BodyType<CompanyTemplateUpload>;
};
export declare const useUploadCompanyTemplate: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof uploadCompanyTemplate>>, TError, UploadCompanyTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof uploadCompanyTemplate>>, TError, UploadCompanyTemplateMutationVariables, TContext>;
export declare const getPreviewCompanyTemplateUrl: (id: string) => string;
export declare const previewCompanyTemplate: (id: string, sharedVersion: SharedVersion, options?: Parameters<typeof customFetch>[1]) => Promise<Blob>;
export declare const getPreviewCompanyTemplateMutationKey: () => readonly ["previewCompanyTemplate"];
export declare const getPreviewCompanyTemplateMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof previewCompanyTemplate>>, TError, PreviewCompanyTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof previewCompanyTemplate>>, TError, PreviewCompanyTemplateMutationVariables, TContext>;
export type PreviewCompanyTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof previewCompanyTemplate>>>;
export type PreviewCompanyTemplateMutationBody = BodyType<SharedVersion>;
export type PreviewCompanyTemplateMutationError = ErrorType<unknown>;
export type PreviewCompanyTemplateMutationVariables = {
    id: string;
    data: BodyType<SharedVersion>;
};
export declare const usePreviewCompanyTemplate: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof previewCompanyTemplate>>, TError, PreviewCompanyTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof previewCompanyTemplate>>, TError, PreviewCompanyTemplateMutationVariables, TContext>;
export declare const getSelectCompanyTemplateUrl: (id: string) => string;
export declare const selectCompanyTemplate: (id: string, sharedVersion: SharedVersion, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getSelectCompanyTemplateMutationKey: () => readonly ["selectCompanyTemplate"];
export declare const getSelectCompanyTemplateMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof selectCompanyTemplate>>, TError, SelectCompanyTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof selectCompanyTemplate>>, TError, SelectCompanyTemplateMutationVariables, TContext>;
export type SelectCompanyTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof selectCompanyTemplate>>>;
export type SelectCompanyTemplateMutationBody = BodyType<SharedVersion>;
export type SelectCompanyTemplateMutationError = ErrorType<unknown>;
export type SelectCompanyTemplateMutationVariables = {
    id: string;
    data: BodyType<SharedVersion>;
};
export declare const useSelectCompanyTemplate: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof selectCompanyTemplate>>, TError, SelectCompanyTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof selectCompanyTemplate>>, TError, SelectCompanyTemplateMutationVariables, TContext>;
export declare const getListSharedApprovalsUrl: (params?: ListSharedApprovalsParams) => string;
export declare const listSharedApprovals: (params?: ListSharedApprovalsParams, options?: Parameters<typeof customFetch>[1]) => Promise<ApprovalPage>;
export declare const getListSharedApprovalsQueryKey: (params?: ListSharedApprovalsParams) => readonly ["/api/shared-assessments/approvals/list", ...ListSharedApprovalsParams[]];
export declare const getListSharedApprovalsQueryOptions: <TData = Awaited<ReturnType<typeof listSharedApprovals>>, TError = ErrorType<void>>(params?: ListSharedApprovalsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSharedApprovals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listSharedApprovals>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListSharedApprovalsQueryResult = NonNullable<Awaited<ReturnType<typeof listSharedApprovals>>>;
export type ListSharedApprovalsQueryError = ErrorType<void>;
export declare function useListSharedApprovals<TData = Awaited<ReturnType<typeof listSharedApprovals>>, TError = ErrorType<void>>(params?: ListSharedApprovalsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSharedApprovals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getDownloadSharedApprovalsUrl: () => string;
export declare const downloadSharedApprovals: (approvedDownload: ApprovedDownload, options?: Parameters<typeof customFetch>[1]) => Promise<Blob>;
export declare const getDownloadSharedApprovalsMutationKey: () => readonly ["downloadSharedApprovals"];
export declare const getDownloadSharedApprovalsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof downloadSharedApprovals>>, TError, DownloadSharedApprovalsMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof downloadSharedApprovals>>, TError, DownloadSharedApprovalsMutationVariables, TContext>;
export type DownloadSharedApprovalsMutationResult = NonNullable<Awaited<ReturnType<typeof downloadSharedApprovals>>>;
export type DownloadSharedApprovalsMutationBody = BodyType<ApprovedDownload>;
export type DownloadSharedApprovalsMutationError = ErrorType<unknown>;
export type DownloadSharedApprovalsMutationVariables = {
    data: BodyType<ApprovedDownload>;
};
export declare const useDownloadSharedApprovals: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof downloadSharedApprovals>>, TError, DownloadSharedApprovalsMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof downloadSharedApprovals>>, TError, DownloadSharedApprovalsMutationVariables, TContext>;
export declare const getGetKnowledgeCleanupUrl: () => string;
export declare const getKnowledgeCleanup: (options?: Parameters<typeof customFetch>[1]) => Promise<KnowledgeCleanupStatus>;
export declare const getGetKnowledgeCleanupQueryKey: () => readonly ["/api/clean-core/knowledge/cleanup"];
export declare const getGetKnowledgeCleanupQueryOptions: <TData = Awaited<ReturnType<typeof getKnowledgeCleanup>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getKnowledgeCleanup>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getKnowledgeCleanup>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetKnowledgeCleanupQueryResult = NonNullable<Awaited<ReturnType<typeof getKnowledgeCleanup>>>;
export type GetKnowledgeCleanupQueryError = ErrorType<unknown>;
export declare function useGetKnowledgeCleanup<TData = Awaited<ReturnType<typeof getKnowledgeCleanup>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getKnowledgeCleanup>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getRunKnowledgeCleanupUrl: () => string;
export declare const runKnowledgeCleanup: (knowledgeCleanupInput: KnowledgeCleanupInput, options?: Parameters<typeof customFetch>[1]) => Promise<KnowledgeCleanupReport>;
export declare const getRunKnowledgeCleanupMutationKey: () => readonly ["runKnowledgeCleanup"];
export declare const getRunKnowledgeCleanupMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runKnowledgeCleanup>>, TError, RunKnowledgeCleanupMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof runKnowledgeCleanup>>, TError, RunKnowledgeCleanupMutationVariables, TContext>;
export type RunKnowledgeCleanupMutationResult = NonNullable<Awaited<ReturnType<typeof runKnowledgeCleanup>>>;
export type RunKnowledgeCleanupMutationBody = BodyType<KnowledgeCleanupInput>;
export type RunKnowledgeCleanupMutationError = ErrorType<unknown>;
export type RunKnowledgeCleanupMutationVariables = {
    data: BodyType<KnowledgeCleanupInput>;
};
export declare const useRunKnowledgeCleanup: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof runKnowledgeCleanup>>, TError, RunKnowledgeCleanupMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof runKnowledgeCleanup>>, TError, RunKnowledgeCleanupMutationVariables, TContext>;
export declare const getListReportTemplatesUrl: () => string;
export declare const listReportTemplates: (options?: Parameters<typeof customFetch>[1]) => Promise<ListReportTemplates200>;
export declare const getListReportTemplatesQueryKey: () => readonly ["/api/report-templates"];
export declare const getListReportTemplatesQueryOptions: <TData = Awaited<ReturnType<typeof listReportTemplates>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReportTemplates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listReportTemplates>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListReportTemplatesQueryResult = NonNullable<Awaited<ReturnType<typeof listReportTemplates>>>;
export type ListReportTemplatesQueryError = ErrorType<unknown>;
export declare function useListReportTemplates<TData = Awaited<ReturnType<typeof listReportTemplates>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listReportTemplates>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getWordTemplateReferenceUrl: () => string;
export declare const wordTemplateReference: (options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getWordTemplateReferenceQueryKey: () => readonly ["/api/report-templates/reference"];
export declare const getWordTemplateReferenceQueryOptions: <TData = Awaited<ReturnType<typeof wordTemplateReference>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof wordTemplateReference>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof wordTemplateReference>>, TError, TData> & {
    queryKey: QueryKey;
};
export type WordTemplateReferenceQueryResult = NonNullable<Awaited<ReturnType<typeof wordTemplateReference>>>;
export type WordTemplateReferenceQueryError = ErrorType<unknown>;
export declare function useWordTemplateReference<TData = Awaited<ReturnType<typeof wordTemplateReference>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof wordTemplateReference>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getDownloadWordTemplateSampleUrl: (params?: DownloadWordTemplateSampleParams) => string;
export declare const downloadWordTemplateSample: (params?: DownloadWordTemplateSampleParams, options?: Parameters<typeof customFetch>[1]) => Promise<Blob>;
export declare const getDownloadWordTemplateSampleQueryKey: (params?: DownloadWordTemplateSampleParams) => readonly ["/api/report-templates/sample", ...DownloadWordTemplateSampleParams[]];
export declare const getDownloadWordTemplateSampleQueryOptions: <TData = Awaited<ReturnType<typeof downloadWordTemplateSample>>, TError = ErrorType<unknown>>(params?: DownloadWordTemplateSampleParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadWordTemplateSample>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof downloadWordTemplateSample>>, TError, TData> & {
    queryKey: QueryKey;
};
export type DownloadWordTemplateSampleQueryResult = NonNullable<Awaited<ReturnType<typeof downloadWordTemplateSample>>>;
export type DownloadWordTemplateSampleQueryError = ErrorType<unknown>;
export declare function useDownloadWordTemplateSample<TData = Awaited<ReturnType<typeof downloadWordTemplateSample>>, TError = ErrorType<unknown>>(params?: DownloadWordTemplateSampleParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadWordTemplateSample>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getStartWordTemplateUploadUrl: () => string;
export declare const startWordTemplateUpload: (wordUploadInput: WordUploadInput, options?: Parameters<typeof customFetch>[1]) => Promise<StartWordTemplateUpload200>;
export declare const getStartWordTemplateUploadMutationKey: () => readonly ["startWordTemplateUpload"];
export declare const getStartWordTemplateUploadMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startWordTemplateUpload>>, TError, StartWordTemplateUploadMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof startWordTemplateUpload>>, TError, StartWordTemplateUploadMutationVariables, TContext>;
export type StartWordTemplateUploadMutationResult = NonNullable<Awaited<ReturnType<typeof startWordTemplateUpload>>>;
export type StartWordTemplateUploadMutationBody = BodyType<WordUploadInput>;
export type StartWordTemplateUploadMutationError = ErrorType<unknown>;
export type StartWordTemplateUploadMutationVariables = {
    data: BodyType<WordUploadInput>;
};
export declare const useStartWordTemplateUpload: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startWordTemplateUpload>>, TError, StartWordTemplateUploadMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof startWordTemplateUpload>>, TError, StartWordTemplateUploadMutationVariables, TContext>;
export declare const getValidateWordTemplateUploadUrl: (id: string) => string;
export declare const validateWordTemplateUpload: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<WordTemplate>;
export declare const getValidateWordTemplateUploadMutationKey: () => readonly ["validateWordTemplateUpload"];
export declare const getValidateWordTemplateUploadMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof validateWordTemplateUpload>>, TError, ValidateWordTemplateUploadMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof validateWordTemplateUpload>>, TError, ValidateWordTemplateUploadMutationVariables, TContext>;
export type ValidateWordTemplateUploadMutationResult = NonNullable<Awaited<ReturnType<typeof validateWordTemplateUpload>>>;
export type ValidateWordTemplateUploadMutationError = ErrorType<unknown>;
export type ValidateWordTemplateUploadMutationVariables = {
    id: string;
};
export declare const useValidateWordTemplateUpload: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof validateWordTemplateUpload>>, TError, ValidateWordTemplateUploadMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof validateWordTemplateUpload>>, TError, ValidateWordTemplateUploadMutationVariables, TContext>;
export declare const getUpdateWordTemplateUrl: (id: string) => string;
export declare const updateWordTemplate: (id: string, wordUpdateInput: WordUpdateInput, options?: Parameters<typeof customFetch>[1]) => Promise<WordTemplate>;
export declare const getUpdateWordTemplateMutationKey: () => readonly ["updateWordTemplate"];
export declare const getUpdateWordTemplateMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateWordTemplate>>, TError, UpdateWordTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateWordTemplate>>, TError, UpdateWordTemplateMutationVariables, TContext>;
export type UpdateWordTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof updateWordTemplate>>>;
export type UpdateWordTemplateMutationBody = BodyType<WordUpdateInput>;
export type UpdateWordTemplateMutationError = ErrorType<unknown>;
export type UpdateWordTemplateMutationVariables = {
    id: string;
    data: BodyType<WordUpdateInput>;
};
export declare const useUpdateWordTemplate: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateWordTemplate>>, TError, UpdateWordTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateWordTemplate>>, TError, UpdateWordTemplateMutationVariables, TContext>;
export declare const getDeleteWordTemplateUrl: (id: string) => string;
export declare const deleteWordTemplate: (id: string, wordDeleteInput: WordDeleteInput, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getDeleteWordTemplateMutationKey: () => readonly ["deleteWordTemplate"];
export declare const getDeleteWordTemplateMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteWordTemplate>>, TError, DeleteWordTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteWordTemplate>>, TError, DeleteWordTemplateMutationVariables, TContext>;
export type DeleteWordTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof deleteWordTemplate>>>;
export type DeleteWordTemplateMutationBody = BodyType<WordDeleteInput>;
export type DeleteWordTemplateMutationError = ErrorType<unknown>;
export type DeleteWordTemplateMutationVariables = {
    id: string;
    data: BodyType<WordDeleteInput>;
};
export declare const useDeleteWordTemplate: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteWordTemplate>>, TError, DeleteWordTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteWordTemplate>>, TError, DeleteWordTemplateMutationVariables, TContext>;
export declare const getPreviewWordTemplateUrl: () => string;
export declare const previewWordTemplate: (wordPreviewInput: WordPreviewInput, options?: Parameters<typeof customFetch>[1]) => Promise<Blob>;
export declare const getPreviewWordTemplateMutationKey: () => readonly ["previewWordTemplate"];
export declare const getPreviewWordTemplateMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof previewWordTemplate>>, TError, PreviewWordTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof previewWordTemplate>>, TError, PreviewWordTemplateMutationVariables, TContext>;
export type PreviewWordTemplateMutationResult = NonNullable<Awaited<ReturnType<typeof previewWordTemplate>>>;
export type PreviewWordTemplateMutationBody = BodyType<WordPreviewInput>;
export type PreviewWordTemplateMutationError = ErrorType<unknown>;
export type PreviewWordTemplateMutationVariables = {
    data: BodyType<WordPreviewInput>;
};
export declare const usePreviewWordTemplate: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof previewWordTemplate>>, TError, PreviewWordTemplateMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof previewWordTemplate>>, TError, PreviewWordTemplateMutationVariables, TContext>;
export declare const getRenderWordReportsUrl: () => string;
export declare const renderWordReports: (wordRenderInput: WordRenderInput, options?: Parameters<typeof customFetch>[1]) => Promise<Blob>;
export declare const getRenderWordReportsMutationKey: () => readonly ["renderWordReports"];
export declare const getRenderWordReportsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof renderWordReports>>, TError, RenderWordReportsMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof renderWordReports>>, TError, RenderWordReportsMutationVariables, TContext>;
export type RenderWordReportsMutationResult = NonNullable<Awaited<ReturnType<typeof renderWordReports>>>;
export type RenderWordReportsMutationBody = BodyType<WordRenderInput>;
export type RenderWordReportsMutationError = ErrorType<unknown>;
export type RenderWordReportsMutationVariables = {
    data: BodyType<WordRenderInput>;
};
export declare const useRenderWordReports: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof renderWordReports>>, TError, RenderWordReportsMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof renderWordReports>>, TError, RenderWordReportsMutationVariables, TContext>;
export declare const getListKnowledgeUrl: (params?: ListKnowledgeParams) => string;
export declare const listKnowledge: (params?: ListKnowledgeParams, options?: Parameters<typeof customFetch>[1]) => Promise<KnowledgeList>;
export declare const getListKnowledgeQueryKey: (params?: ListKnowledgeParams) => readonly ["/api/clean-core/knowledge", ...ListKnowledgeParams[]];
export declare const getListKnowledgeQueryOptions: <TData = Awaited<ReturnType<typeof listKnowledge>>, TError = ErrorType<unknown>>(params?: ListKnowledgeParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listKnowledge>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listKnowledge>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListKnowledgeQueryResult = NonNullable<Awaited<ReturnType<typeof listKnowledge>>>;
export type ListKnowledgeQueryError = ErrorType<unknown>;
export declare function useListKnowledge<TData = Awaited<ReturnType<typeof listKnowledge>>, TError = ErrorType<unknown>>(params?: ListKnowledgeParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listKnowledge>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getStartKnowledgeUploadUrl: () => string;
export declare const startKnowledgeUpload: (knowledgeUpload: KnowledgeUpload, options?: Parameters<typeof customFetch>[1]) => Promise<KnowledgeUploadTicket>;
export declare const getStartKnowledgeUploadMutationKey: () => readonly ["startKnowledgeUpload"];
export declare const getStartKnowledgeUploadMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startKnowledgeUpload>>, TError, StartKnowledgeUploadMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof startKnowledgeUpload>>, TError, StartKnowledgeUploadMutationVariables, TContext>;
export type StartKnowledgeUploadMutationResult = NonNullable<Awaited<ReturnType<typeof startKnowledgeUpload>>>;
export type StartKnowledgeUploadMutationBody = BodyType<KnowledgeUpload>;
export type StartKnowledgeUploadMutationError = ErrorType<unknown>;
export type StartKnowledgeUploadMutationVariables = {
    data: BodyType<KnowledgeUpload>;
};
export declare const useStartKnowledgeUpload: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof startKnowledgeUpload>>, TError, StartKnowledgeUploadMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof startKnowledgeUpload>>, TError, StartKnowledgeUploadMutationVariables, TContext>;
export declare const getGetKnowledgeDocumentUrl: (id: string) => string;
export declare const getKnowledgeDocument: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<KnowledgeDetail>;
export declare const getGetKnowledgeDocumentQueryKey: (id: string) => readonly [`/api/clean-core/knowledge/${string}`];
export declare const getGetKnowledgeDocumentQueryOptions: <TData = Awaited<ReturnType<typeof getKnowledgeDocument>>, TError = ErrorType<unknown>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getKnowledgeDocument>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getKnowledgeDocument>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetKnowledgeDocumentQueryResult = NonNullable<Awaited<ReturnType<typeof getKnowledgeDocument>>>;
export type GetKnowledgeDocumentQueryError = ErrorType<unknown>;
export declare function useGetKnowledgeDocument<TData = Awaited<ReturnType<typeof getKnowledgeDocument>>, TError = ErrorType<unknown>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getKnowledgeDocument>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getRemoveKnowledgeDocumentUrl: (id: string) => string;
export declare const removeKnowledgeDocument: (id: string, knowledgeVersion: KnowledgeVersion, options?: Parameters<typeof customFetch>[1]) => Promise<void>;
export declare const getRemoveKnowledgeDocumentMutationKey: () => readonly ["removeKnowledgeDocument"];
export declare const getRemoveKnowledgeDocumentMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof removeKnowledgeDocument>>, TError, RemoveKnowledgeDocumentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof removeKnowledgeDocument>>, TError, RemoveKnowledgeDocumentMutationVariables, TContext>;
export type RemoveKnowledgeDocumentMutationResult = NonNullable<Awaited<ReturnType<typeof removeKnowledgeDocument>>>;
export type RemoveKnowledgeDocumentMutationBody = BodyType<KnowledgeVersion>;
export type RemoveKnowledgeDocumentMutationError = ErrorType<unknown>;
export type RemoveKnowledgeDocumentMutationVariables = {
    id: string;
    data: BodyType<KnowledgeVersion>;
};
export declare const useRemoveKnowledgeDocument: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof removeKnowledgeDocument>>, TError, RemoveKnowledgeDocumentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof removeKnowledgeDocument>>, TError, RemoveKnowledgeDocumentMutationVariables, TContext>;
export declare const getProcessKnowledgeUploadUrl: (id: string) => string;
export declare const processKnowledgeUpload: (id: string, options?: Parameters<typeof customFetch>[1]) => Promise<KnowledgeDocument>;
export declare const getProcessKnowledgeUploadMutationKey: () => readonly ["processKnowledgeUpload"];
export declare const getProcessKnowledgeUploadMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof processKnowledgeUpload>>, TError, ProcessKnowledgeUploadMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof processKnowledgeUpload>>, TError, ProcessKnowledgeUploadMutationVariables, TContext>;
export type ProcessKnowledgeUploadMutationResult = NonNullable<Awaited<ReturnType<typeof processKnowledgeUpload>>>;
export type ProcessKnowledgeUploadMutationError = ErrorType<unknown>;
export type ProcessKnowledgeUploadMutationVariables = {
    id: string;
};
export declare const useProcessKnowledgeUpload: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof processKnowledgeUpload>>, TError, ProcessKnowledgeUploadMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof processKnowledgeUpload>>, TError, ProcessKnowledgeUploadMutationVariables, TContext>;
export declare const getDownloadKnowledgeFileUrl: (id: string, version: number) => string;
export declare const downloadKnowledgeFile: (id: string, version: number, options?: Parameters<typeof customFetch>[1]) => Promise<Blob>;
export declare const getDownloadKnowledgeFileQueryKey: (id: string, version: number) => readonly [`/api/clean-core/knowledge/${string}/file/${number}`];
export declare const getDownloadKnowledgeFileQueryOptions: <TData = Awaited<ReturnType<typeof downloadKnowledgeFile>>, TError = ErrorType<unknown>>(id: string, version: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadKnowledgeFile>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof downloadKnowledgeFile>>, TError, TData> & {
    queryKey: QueryKey;
};
export type DownloadKnowledgeFileQueryResult = NonNullable<Awaited<ReturnType<typeof downloadKnowledgeFile>>>;
export type DownloadKnowledgeFileQueryError = ErrorType<unknown>;
export declare function useDownloadKnowledgeFile<TData = Awaited<ReturnType<typeof downloadKnowledgeFile>>, TError = ErrorType<unknown>>(id: string, version: number, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof downloadKnowledgeFile>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
export declare const getPreviewAssessmentExplanationUrl: () => string;
export declare const previewAssessmentExplanation: (knowledgeAiRequest: KnowledgeAiRequest, options?: Parameters<typeof customFetch>[1]) => Promise<KnowledgePreview>;
export declare const getPreviewAssessmentExplanationMutationKey: () => readonly ["previewAssessmentExplanation"];
export declare const getPreviewAssessmentExplanationMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof previewAssessmentExplanation>>, TError, PreviewAssessmentExplanationMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof previewAssessmentExplanation>>, TError, PreviewAssessmentExplanationMutationVariables, TContext>;
export type PreviewAssessmentExplanationMutationResult = NonNullable<Awaited<ReturnType<typeof previewAssessmentExplanation>>>;
export type PreviewAssessmentExplanationMutationBody = BodyType<KnowledgeAiRequest>;
export type PreviewAssessmentExplanationMutationError = ErrorType<unknown>;
export type PreviewAssessmentExplanationMutationVariables = {
    data: BodyType<KnowledgeAiRequest>;
};
export declare const usePreviewAssessmentExplanation: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof previewAssessmentExplanation>>, TError, PreviewAssessmentExplanationMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof previewAssessmentExplanation>>, TError, PreviewAssessmentExplanationMutationVariables, TContext>;
export declare const getListAccountAuditUrl: (params?: ListAccountAuditParams) => string;
export declare const listAccountAudit: (params?: ListAccountAuditParams, options?: Parameters<typeof customFetch>[1]) => Promise<AccountAuditPage>;
export declare const getListAccountAuditQueryKey: (params?: ListAccountAuditParams) => readonly ["/api/admin/audit", ...ListAccountAuditParams[]];
export declare const getListAccountAuditQueryOptions: <TData = Awaited<ReturnType<typeof listAccountAudit>>, TError = ErrorType<void>>(params?: ListAccountAuditParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAccountAudit>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAccountAudit>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAccountAuditQueryResult = NonNullable<Awaited<ReturnType<typeof listAccountAudit>>>;
export type ListAccountAuditQueryError = ErrorType<void>;
export declare function useListAccountAudit<TData = Awaited<ReturnType<typeof listAccountAudit>>, TError = ErrorType<void>>(params?: ListAccountAuditParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAccountAudit>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
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
export declare const explainAssessment: (knowledgeAiConsent: KnowledgeAiConsent, options?: Parameters<typeof customFetch>[1]) => Promise<AssessmentExplanation>;
export declare const getExplainAssessmentMutationKey: () => readonly ["explainAssessment"];
export declare const getExplainAssessmentMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof explainAssessment>>, TError, ExplainAssessmentMutationVariables, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof explainAssessment>>, TError, ExplainAssessmentMutationVariables, TContext>;
export type ExplainAssessmentMutationResult = NonNullable<Awaited<ReturnType<typeof explainAssessment>>>;
export type ExplainAssessmentMutationBody = BodyType<KnowledgeAiConsent>;
export type ExplainAssessmentMutationError = ErrorType<void>;
export type ExplainAssessmentMutationVariables = {
    data: BodyType<KnowledgeAiConsent>;
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