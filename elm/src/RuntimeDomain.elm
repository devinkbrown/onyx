module RuntimeDomain exposing (Action(..), decodeGroupItems, decodeOperatorItems, AccountCommunityView, Command, DraftRecovered, DraftRecoveryView, DraftRecoveryItem, MediaControlView, MediaDeviceView, MediaDeviceChoice, MediaQualityView, MediaTelemetryView, MediaRecordingView, MediaSoundcheckView, MediaCaptionView, MediaWebRtcView, PasskeyManagementView, PasskeyRow, ResultView, SafeItem, ScheduledItem, ScheduledListView, ServiceIntegrationView, ServiceIntegrationRow, SessionInventoryView, SessionLocalRow, SessionMeshRow, SessionRecoveryView, SessionRevocationView, Status(..), WebAuthnView, actionName, commandEncoder, decodeAccountCommunityView, decodeDraftRecoveryView, decodeMediaControlView, decodeMediaQualityView, decodePasskeyManagementView, decodeResult, decodeScheduledListView, decodeServiceIntegrationView, decodeSessionInventoryView, decodeSessionRecoveryView, decodeSessionRevocationView, decodeWebAuthnView)

{-| Typed, reference-only commands for browser-private roadmap services.
There is deliberately no constructor for a raw line, file body, bearer,
private key, media stream, or arbitrary JSON payload.
-}

import Ids exposing (AccountGeneration, ConnectionGeneration, OwnerRef, RequestId)
import Json.Decode as Decode
import Json.Encode as Encode
import Wire


type Action
    = ListSessionIntents
    | NewSessionAttachment
    | ResumeSession String Bool
    | RetrySession String Bool
    | ForgetSession String
    | RememberSession Bool
    | LocalSessionList
    | LocalSessionDrop String
    | MeshSessionList
    | MeshSessionNext String
    | MeshSessionRevoke String
    | MeshSessionReconcile String
    | MeshSessionDismiss String
    | ListContinuations
    | RememberContinuation String Bool
    | ForgetContinuation String
    | SelectContinuation String
    | UseContinuation String
    | AccountSecurityBegin String (Maybe String) (Maybe String)
    | AccountSecurityPresentation String String (Maybe String)
    | PasskeyList
    | PasskeyRename String String
    | PasskeyRemove String
    | AutojoinList
    | AutojoinAdd String
    | AutojoinRemove String
    | GroupList
    | GroupAdd String
    | GroupRemove String
    | GroupPrimary String
    | ServiceRefresh String
    | ServiceBotGrantList (Maybe String)
    | ServiceBotGrantAdd String String String Int
    | ServiceBotGrantRemove String String String
    | ServiceBotCommandList
    | ServiceBotCommandAdd String Int String
    | ServiceBotCommandRun String (List String)
    | ServiceDeferAt Float String String
    | ServiceDeferCron String String String String String String String
    | ServiceDeferOperAt Float String Char
    | ServiceDeferOperCron String String String String String String Char
    | ServiceOutHookInput
    | ServiceOutHookAdd String
    | ServiceOutHookList
    | ServiceOutHookInspect String
    | ServiceOutHookRemove String
    | ServiceUnfurlOff
    | ServiceUnfurlOn
    | ServiceUnfurlPreview String
    | ServiceMemoSend String String
    | ServiceMemoList
    | ServiceMemoClear
    | ServiceMemoForward (Maybe String)
    | ServiceMemoIgnoreList
    | ServiceMemoIgnoreAdd String
    | ServiceMemoIgnoreRemove String
    | WebAuthnBegin String (Maybe String)
    | WebAuthnCancel String
    | NewTabIntent
    | RetireTabIntent String
    | ListWorkspaces
    | RememberWorkspace Bool
    | SelectWorkspace String
    | RegisterWorker
    | InspectPush
    | ListJournal
    | LoadDraft String
    | SaveDraft String String Int
    | SettingsPreview String
    | SettingsApply String (List String)
    | StorageExport String String
    | QueueMessage String String String (Maybe String) String (Maybe Char)
    | ScheduledCreate String String RequestId String Int String (Maybe String) (Maybe Char)
    | ScheduledEdit String String Int Int String (Maybe String) (Maybe Char)
    | ScheduledList
    | ScheduledCancel String Int
    | ScheduledDispatch String Int
    | ScheduledReconcile String Int
    | RestoreSessionIntent String
    | RetryJournal String
    | ReconcileJournal String
    | CancelJournal String
    | LockWorkspace
    | DraftDiscard String Int
    | DraftRecoveryList
    | DraftRecover String
    | SettingsExport String
    | StorageClear String
    | EvictionPreview (List String)
    | EvictionApply String
    | GroupDirectoryRefresh String
    | GroupTrustPreview String String String
    | GroupTrustConfirm String
    | GroupEnroll String
    | GroupWelcomeRequest String Int String
    | GroupCancel String
    | GroupBootstrapPreview String
    | GroupBootstrapApprove String
    | GroupBootstrapCancel String
    | GroupAuthorPlan String Int String
    | GroupAuthorCommit String String
    | GroupRemoveDevice String String String Int String
    | GroupBackupExport String Int String String String
    | GroupBackupImport String String String String
    | GroupBackupApprove String String
    | GroupBackupCancel String
    | MediaJoin String String String
    | MediaLeave (Maybe String)
    | MediaInspect
    | MediaRosterRefresh String String
    | MediaDevicesRefresh
    | MediaInput { deviceRef : Maybe String, conversationId : Maybe String, callRef : Maybe String, captureRef : Maybe String }
    | MediaOutput { deviceRef : Maybe String, volumePercent : Int }
    | MediaConsent { conversationId : String, callRef : String, consent : String, policyRevision : Maybe String }
    | MediaRecord { conversationId : String, callRef : String, action : String, consentRevision : Maybe String }
    | MediaSoundcheck String Int
    | MediaAudioRecover String String
    | MediaCaptionPrepare String String String
    | MediaCaptionStart String String String String Bool
    | MediaCaptionStop String String
    | MediaMute Bool
    | MediaDeafen Bool
    | MediaCameraPreview String String
    | MediaCameraPublish String String
    | MediaQuality String String String
    | MediaPreviewRetire String
    | MediaScreenStart String String
    | MediaScreenStop String
    | MediaWebRtcRun String String
    | MediaWebRtcStop String
    | AnchorViewed String (Maybe String) (Maybe String)
    | AnchorLoad String
    | PushEnable String
    | PushDisable
    | PushReconcile
    | WorkerActivate String
    | WorkerCancel String
    | OperatorImportDismiss String
    | OperatorImportGet String
    | WebTransportFallback String
    | WebTransportConnect String
    | ReconnectMedia
    | OperatorImportPreview String


type alias Command =
    { requestId : RequestId
    , ownerRef : OwnerRef
    , accountGeneration : AccountGeneration
    , connectionGeneration : ConnectionGeneration
    , action : Action
    }


type Status = Pending | Held | TransportAdmitted | Accepted | Unknown | Blocked | Failed | Cancelled


type alias SessionTransferStamp =
    { ownerRef : String, accountGeneration : Int, connectionGeneration : Int }


type alias SessionRecoveryView =
    { requestId : String
    , credentialRef : String
    , status : String
    , outcome : Maybe String
    , reason : Maybe String
    , redirectNode : Maybe String
    , hopCount : Int
    , transferFrom : Maybe SessionTransferStamp
    }


type alias PasskeyRow =
    { credentialRef : String, label : String, signCount : String, createdUnix : String }


type alias PasskeyManagementView =
    { requestId : String
    , status : String
    , operation : Maybe String
    , rows : List PasskeyRow
    , reason : Maybe String
    }


type alias SessionLocalRow =
    { rowRef : String
    , index : Int
    , signonMs : String
    , state : String
    , current : Bool
    }


type alias SessionMeshRow =
    { rowRef : String
    , groupRef : String
    , attachmentId : Maybe String
    , nodeHex : String
    , state : String
    , inventory : String
    , coverage : String
    , observedAt : String
    }


type alias SessionInventoryView =
    { requestId : String
    , mode : String
    , status : String
    , scanRef : Maybe String
    , localRows : List SessionLocalRow
    , meshRows : List SessionMeshRow
    , continuationAvailable : Bool
    , scanComplete : Bool
    , pageCount : Int
    , lastObservedAt : Maybe String
    , reason : Maybe String
    }


type alias SessionRevocationView =
    { requestId : String
    , revokeRef : String
    , groupRef : String
    , status : String
    , reason : Maybe String
    }


type alias AccountCommunityGroupRow =
    { nick : String, primary : Bool }


type alias AccountCommunityView =
    { requestId : String
    , section : String
    , status : String
    , operation : String
    , autojoinRows : List String
    , groupRows : List AccountCommunityGroupRow
    , reason : Maybe String
    }


type alias ServiceIntegrationRow =
    { kind : String
    , label : String
    , value : Maybe String
    , ref : Maybe String
    }


type alias ServiceIntegrationView =
    { requestId : String
    , feature : String
    , operation : Maybe String
    , phase : String
    , registry : String
    , effectiveFeature : String
    , accountProof : String
    , authorization : String
    , reason : Maybe String
    , rows : List ServiceIntegrationRow
    , inputRef : Maybe String
    }


type alias DraftRecoveryItem =
    { draftRef : String
    , conversationId : String
    , revision : Float
    , updatedAtMs : Float
    , ciphertextBytes : Int
    }


type alias DraftRecovered =
    { draftRef : String
    , conversationId : String
    , revision : Float
    , text : String
    }


type alias DraftRecoveryView =
    { requestId : String
    , status : String
    , items : List DraftRecoveryItem
    , recovered : Maybe DraftRecovered
    , truncated : Bool
    , reason : Maybe String
    }


type alias MediaQualityView =
    { requestId : String
    , conversationId : String
    , callRef : String
    , desiredPolicy : String
    , observedNetworkTier : Maybe Int
    , observedAudioQuality : Maybe Int
    , videoState : String
    }


type alias MediaDeviceChoice =
    { ref : String, label : String }


type alias MediaDeviceView =
    { inputs : List MediaDeviceChoice
    , outputs : List MediaDeviceChoice
    , selectedInputRef : Maybe String
    , requestedInputRef : Maybe String
    , appliedInputRef : Maybe String
    , inputState : String
    , inputReason : Maybe String
    , selectedOutputRef : Maybe String
    , requestedOutputRef : Maybe String
    , appliedOutputRef : Maybe String
    , outputState : String
    , outputReason : Maybe String
    , requestedVolumePercent : Int
    , appliedVolumePercent : Maybe Int
    }


type alias MediaSoundcheckView =
    { state : String, rms : Maybe Float, sampledFrames : Int }


type alias MediaRecordingView =
    { ownConsent : String
    , consentRequest : String
    , desiredAction : Maybe String
    , requestState : String
    , actual : String
    , rosterState : String
    , allConsented : Maybe Bool
    , policyRevision : Maybe String
    , reason : Maybe String
    }


type alias MediaTelemetryView =
    { sampledAtMonotonicMs : Float
    , counters : List ( String, Maybe Float )
    , availability : String
    , reason : Maybe String
    }


type alias MediaCaptionView =
    { conversationId : String
    , callRef : String
    , state : String
    , reason : Maybe String
    , mode : Maybe String
    , language : Maybe String
    , source : Maybe String
    , accuracy : Maybe String
    , interimText : Maybe String
    , serverVisible : Bool
    }


type alias MediaWebRtcView =
    { scope : String
    , reason : Maybe String
    , connectionState : Maybe String
    , bytes : Maybe Float
    , packets : Maybe Float
    , frames : Maybe Float
    , durationMs : Maybe Float
    }


type alias MediaExperimentView =
    { phase : String
    , audioCodec : Maybe String
    , videoCodec : Maybe String
    , iceState : String
    , dtlsState : String
    , transportClass : String
    }


type alias MediaControlView =
    { sequence : Int
    , state : String
    , previewRef : Maybe String
    , screenRef : Maybe String
    , experimentRef : Maybe String
    , experiment : Maybe MediaExperimentView
    , call : Maybe { conversationId : String, callRef : String }
    , reason : Maybe String
    , muted : Bool
    , deafened : Bool
    , devices : MediaDeviceView
    , soundcheck : Maybe MediaSoundcheckView
    , recording : MediaRecordingView
    , telemetry : MediaTelemetryView
    , caption : Maybe MediaCaptionView
    , webRtc : Maybe MediaWebRtcView
    }


type alias WebAuthnView =
    { requestId : String
    , ceremonyRef : Maybe String
    , ceremony : String
    , phase : String
    , reason : Maybe String
    }


type alias ResultView =
    { requestId : RequestId, ownerRef : OwnerRef, accountGeneration : AccountGeneration
    , connectionGeneration : ConnectionGeneration, domain : String, action : String
    , status : Status, completionScope : String, reason : Maybe String, items : List SafeItem
    , draftTarget : Maybe String, draftText : Maybe String, draftRevision : Maybe Int, selectedContinuationRef : Maybe String
    , anchorTarget : Maybe String, anchorAcceptedTimestamp : Maybe String, anchorViewedCandidate : Maybe String
    , scheduledMode : Maybe String, scheduledLegacyHeldCount : Int, scheduledLegacyReviewUnavailable : Bool, scheduledViewReady : Bool
    , scheduledItems : List ScheduledItem
    , sessionRecovery : Maybe SessionRecoveryView
    , passkeyManagement : Maybe PasskeyManagementView
    , sessionInventory : Maybe SessionInventoryView
    , sessionRevocation : Maybe SessionRevocationView
    , accountCommunity : Maybe AccountCommunityView
    , serviceIntegration : Maybe ServiceIntegrationView
    , draftRecovery : Maybe DraftRecoveryView
    , mediaQuality : Maybe MediaQualityView
    , mediaControl : Maybe MediaControlView
    }


type alias SafeItem = { ref : String, label : String, state : String, extra : List String }


type alias ScheduledItem =
    { scheduleRef : String
    , operationId : Maybe String
    , conversationId : Maybe String
    , dueAtMs : Maybe Int
    , messageKind : Maybe String
    , replyTo : Maybe String
    , audiencePrefix : Maybe Char
    , revision : Maybe Int
    , mode : String
    , state : String
    }


type alias ScheduledListView =
    { mode : String
    , legacyHeldCount : Int
    , legacyReviewUnavailable : Bool
    , items : List ScheduledItem
    }


decodeScheduledListView : Decode.Value -> Maybe ScheduledListView
decodeScheduledListView value =
    Decode.decodeValue
        (Decode.map4 ScheduledListView
            (Decode.field "mode" (Decode.string |> Decode.andThen (\mode -> if List.member mode [ "durable", "volatile" ] then Decode.succeed mode else Decode.fail "invalid scheduled mode")))
            (Decode.field "legacyHeldCount" (Decode.int |> Decode.andThen (\count -> if count >= 0 && count <= 100000 then Decode.succeed count else Decode.fail "invalid legacy count")))
            (Decode.field "legacyReviewUnavailable" Decode.bool)
            (Decode.field "items" (Decode.list scheduledItemDecoder |> Decode.andThen (\items -> if List.length items <= 256 then Decode.succeed items else Decode.fail "too many scheduled items")))
        )
        value
        |> Result.toMaybe


actionName : Action -> String
actionName action =
    case action of
        ListSessionIntents -> "list"
        NewSessionAttachment -> "new-attachment"
        ResumeSession _ _ -> "resume"
        RetrySession _ _ -> "retry"
        ForgetSession _ -> "forget"
        RememberSession _ -> "remember"
        LocalSessionList -> "local-list"
        LocalSessionDrop _ -> "local-drop"
        MeshSessionList -> "mesh-list"
        MeshSessionNext _ -> "mesh-next"
        MeshSessionRevoke _ -> "mesh-revoke"
        MeshSessionReconcile _ -> "mesh-reconcile"
        MeshSessionDismiss _ -> "mesh-dismiss"
        ListContinuations -> "list"
        RememberContinuation _ _ -> "remember"
        ForgetContinuation _ -> "forget"
        SelectContinuation _ -> "select"
        UseContinuation _ -> "use"
        AccountSecurityBegin _ _ _ -> "begin"
        AccountSecurityPresentation _ _ _ -> "present"
        PasskeyList -> "passkey-list"
        PasskeyRename _ _ -> "passkey-rename"
        PasskeyRemove _ -> "passkey-remove"
        AutojoinList -> "autojoin-list"
        AutojoinAdd _ -> "autojoin-add"
        AutojoinRemove _ -> "autojoin-remove"
        GroupList -> "group-list"
        GroupAdd _ -> "group-add"
        GroupRemove _ -> "group-remove"
        GroupPrimary _ -> "group-primary"
        ServiceRefresh _ -> "refresh"
        ServiceBotGrantList _ -> "botgrant-list"
        ServiceBotGrantAdd _ _ _ _ -> "botgrant-add"
        ServiceBotGrantRemove _ _ _ -> "botgrant-remove"
        ServiceBotCommandList -> "botcmd-list"
        ServiceBotCommandAdd _ _ _ -> "botcmd-add"
        ServiceBotCommandRun _ _ -> "botcmd-run"
        ServiceDeferAt _ _ _ -> "defer-at"
        ServiceDeferCron _ _ _ _ _ _ _ -> "defer-cron"
        ServiceDeferOperAt _ _ _ -> "defer-oper-at"
        ServiceDeferOperCron _ _ _ _ _ _ _ -> "defer-oper-cron"
        ServiceOutHookInput -> "outhook-input"
        ServiceOutHookAdd _ -> "outhook-add"
        ServiceOutHookList -> "outhook-list"
        ServiceOutHookInspect _ -> "outhook-inspect"
        ServiceOutHookRemove _ -> "outhook-remove"
        ServiceUnfurlOff -> "unfurl-off"
        ServiceUnfurlOn -> "unfurl-on"
        ServiceUnfurlPreview _ -> "unfurl-preview"
        ServiceMemoSend _ _ -> "memo-send"
        ServiceMemoList -> "memo-list"
        ServiceMemoClear -> "memo-clear"
        ServiceMemoForward _ -> "memo-forward"
        ServiceMemoIgnoreList -> "memo-ignore-list"
        ServiceMemoIgnoreAdd _ -> "memo-ignore-add"
        ServiceMemoIgnoreRemove _ -> "memo-ignore-remove"
        WebAuthnBegin _ _ -> "begin"
        WebAuthnCancel _ -> "cancel"
        NewTabIntent -> "fresh"
        RetireTabIntent _ -> "retire"
        ListWorkspaces -> "list"
        RememberWorkspace _ -> "remember"
        SelectWorkspace _ -> "select"
        RegisterWorker -> "worker-register"
        InspectPush -> "push-inspect"
        ListJournal -> "list"
        LoadDraft _ -> "load"
        SaveDraft _ _ _ -> "save"
        SettingsPreview _ -> "preview"
        SettingsApply _ _ -> "apply"
        StorageExport _ _ -> "export"
        QueueMessage _ _ _ _ _ _ -> "queue"
        ScheduledCreate _ _ _ _ _ _ _ _ -> "create"
        ScheduledEdit _ _ _ _ _ _ _ -> "edit"
        ScheduledList -> "list"
        ScheduledCancel _ _ -> "cancel"
        ScheduledDispatch _ _ -> "dispatch"
        ScheduledReconcile _ _ -> "reconcile"
        RestoreSessionIntent _ -> "restore"
        RetryJournal _ -> "retry"
        ReconcileJournal _ -> "reconcile"
        CancelJournal _ -> "cancel"
        LockWorkspace -> "lock"
        DraftDiscard _ _ -> "discard"
        DraftRecoveryList -> "recovery-list"
        DraftRecover _ -> "recover"
        SettingsExport _ -> "export"
        StorageClear _ -> "clear"
        EvictionPreview _ -> "preview"
        EvictionApply _ -> "apply"
        GroupDirectoryRefresh _ -> "directory-refresh"
        GroupTrustPreview _ _ _ -> "trust-preview"
        GroupTrustConfirm _ -> "trust-confirm"
        GroupEnroll _ -> "enroll"
        GroupWelcomeRequest _ _ _ -> "welcome-request"
        GroupCancel _ -> "cancel"
        GroupBootstrapPreview _ -> "bootstrap-preview"
        GroupBootstrapApprove _ -> "bootstrap-approve"
        GroupBootstrapCancel _ -> "bootstrap-cancel"
        GroupAuthorPlan _ _ _ -> "author-plan"
        GroupAuthorCommit _ _ -> "author-commit"
        GroupRemoveDevice _ _ _ _ _ -> "remove-device"
        GroupBackupExport _ _ _ _ _ -> "backup-export"
        GroupBackupImport _ _ _ _ -> "backup-import"
        GroupBackupApprove _ _ -> "backup-approve"
        GroupBackupCancel _ -> "backup-cancel"
        MediaJoin _ _ _ -> "join"
        MediaLeave _ -> "leave"
        MediaInspect -> "inspect"
        MediaRosterRefresh _ _ -> "roster-refresh"
        MediaDevicesRefresh -> "devices-refresh"
        MediaInput _ -> "input"
        MediaOutput _ -> "output"
        MediaConsent _ -> "consent"
        MediaRecord _ -> "record"
        MediaSoundcheck _ _ -> "soundcheck"
        MediaAudioRecover _ _ -> "audio-recover"
        MediaCaptionPrepare _ _ _ -> "caption-prepare"
        MediaCaptionStart _ _ _ _ _ -> "caption-start"
        MediaCaptionStop _ _ -> "caption-stop"
        MediaMute _ -> "mute"
        MediaDeafen _ -> "deafen"
        MediaCameraPreview _ _ -> "camera-preview"
        MediaCameraPublish _ _ -> "camera-publish"
        MediaQuality _ _ _ -> "quality"
        MediaPreviewRetire _ -> "preview-retire"
        MediaScreenStart _ _ -> "screen-start"
        MediaScreenStop _ -> "screen-stop"
        MediaWebRtcRun _ _ -> "webrtc-run"
        MediaWebRtcStop _ -> "webrtc-stop"
        AnchorViewed _ _ _ -> "viewed"
        AnchorLoad _ -> "load"
        PushEnable _ -> "push-enable"
        PushDisable -> "push-disable"
        PushReconcile -> "push-reconcile"
        WorkerActivate _ -> "worker-activate"
        WorkerCancel _ -> "worker-cancel"
        WebTransportFallback _ -> "webtransport-fallback"
        ReconnectMedia -> "reconnect-media"
        OperatorImportPreview _ -> "preview"
        OperatorImportDismiss _ -> "dismiss"
        OperatorImportGet _ -> "get"
        WebTransportConnect _ -> "webtransport-connect"


commandEncoder : Command -> Encode.Value
commandEncoder command =
    let
        ( domain, payload ) =
            case command.action of
                ListSessionIntents -> ( "tab-intent", Encode.object [] )
                NewSessionAttachment -> ( "session", Encode.object [] )
                ResumeSession ref legacy -> ( "session", Encode.object ([ ( "credentialRef", Encode.string ref ) ] ++ (if legacy then [ ( "acceptLegacyNewAttachment", Encode.bool True ) ] else [])) )
                RetrySession ref legacy -> ( "session", Encode.object ([ ( "credentialRef", Encode.string ref ) ] ++ (if legacy then [ ( "acceptLegacyNewAttachment", Encode.bool True ) ] else [])) )
                ForgetSession ref -> ( "session", Encode.object [ ( "credentialRef", Encode.string ref ) ] )
                RememberSession enabled -> ( "session", Encode.object [ ( "enabled", Encode.bool enabled ) ] )
                LocalSessionList -> ( "session", Encode.object [] )
                LocalSessionDrop rowRef -> ( "session", Encode.object [ ( "rowRef", Encode.string rowRef ), ( "confirm", Encode.bool True ) ] )
                MeshSessionList -> ( "session", Encode.object [] )
                MeshSessionNext scanRef -> ( "session", Encode.object [ ( "scanRef", Encode.string scanRef ) ] )
                MeshSessionRevoke groupRef -> ( "session", Encode.object [ ( "groupRef", Encode.string groupRef ), ( "confirm", Encode.bool True ) ] )
                MeshSessionReconcile revokeRef -> ( "session", Encode.object [ ( "revokeRef", Encode.string revokeRef ) ] )
                MeshSessionDismiss revokeRef -> ( "session", Encode.object [ ( "revokeRef", Encode.string revokeRef ) ] )
                ListContinuations -> ( "continuation", Encode.object [] )
                RememberContinuation ref enabled -> ( "continuation", Encode.object [ ( "continuationRef", Encode.string ref ), ( "enabled", Encode.bool enabled ) ] )
                ForgetContinuation ref -> ( "continuation", Encode.object [ ( "continuationRef", Encode.string ref ) ] )
                SelectContinuation ref -> ( "continuation", Encode.object [ ( "continuationRef", Encode.string ref ), ( "confirm", Encode.bool True ) ] )
                UseContinuation ref -> ( "continuation", Encode.object [ ( "continuationRef", Encode.string ref ) ] )
                AccountSecurityBegin intent formRef account ->
                    ( "account-security"
                    , Encode.object
                        [ ( "action", Encode.string intent )
                        , ( "formRef", Maybe.withDefault (Encode.null) (Maybe.map Encode.string formRef) )
                        , ( "account", Maybe.withDefault (Encode.null) (Maybe.map Encode.string account) )
                        , ( "confirm", Encode.bool (intent == "account-drop") )
                        ]
                    )
                AccountSecurityPresentation presentationRef action selection ->
                    ( "account-security"
                    , Encode.object
                        [ ( "presentationRef", Encode.string presentationRef )
                        , ( "action", Encode.string action )
                        , ( "selection", Maybe.withDefault (Encode.null) (Maybe.map Encode.string selection) )
                        ]
                    )
                PasskeyList -> ( "account-security", Encode.object [] )
                PasskeyRename credentialRef label -> ( "account-security", Encode.object [ ( "credentialRef", Encode.string credentialRef ), ( "label", Encode.string label ) ] )
                PasskeyRemove credentialRef -> ( "account-security", Encode.object [ ( "credentialRef", Encode.string credentialRef ), ( "confirm", Encode.bool True ) ] )
                AutojoinList -> ( "account-community", Encode.object [] )
                AutojoinAdd channel -> ( "account-community", Encode.object [ ( "channel", Encode.string channel ) ] )
                AutojoinRemove channel -> ( "account-community", Encode.object [ ( "channel", Encode.string channel ), ( "confirm", Encode.bool True ) ] )
                GroupList -> ( "account-community", Encode.object [] )
                GroupAdd nick -> ( "account-community", Encode.object [ ( "nick", Encode.string nick ) ] )
                GroupRemove nick -> ( "account-community", Encode.object [ ( "nick", Encode.string nick ), ( "confirm", Encode.bool True ) ] )
                GroupPrimary nick -> ( "account-community", Encode.object [ ( "nick", Encode.string nick ), ( "confirm", Encode.bool True ) ] )
                ServiceRefresh feature -> ( "service-integration", Encode.object [ ( "feature", Encode.string feature ) ] )
                ServiceBotGrantList account -> ( "service-integration", Encode.object (Maybe.withDefault [] (Maybe.map (\value -> [ ( "account", Encode.string value ) ]) account)) )
                ServiceBotGrantAdd account kind channel ttlSeconds -> ( "service-integration", Encode.object [ ( "account", Encode.string account ), ( "grant", Encode.string kind ), ( "channel", Encode.string channel ), ( "ttlSeconds", Encode.int ttlSeconds ) ] )
                ServiceBotGrantRemove account kind channel -> ( "service-integration", Encode.object [ ( "account", Encode.string account ), ( "grant", Encode.string kind ), ( "channel", Encode.string channel ), ( "confirm", Encode.bool True ) ] )
                ServiceBotCommandList -> ( "service-integration", Encode.object [] )
                ServiceBotCommandAdd name argc help -> ( "service-integration", Encode.object [ ( "name", Encode.string name ), ( "argc", Encode.int argc ), ( "help", Encode.string help ) ] )
                ServiceBotCommandRun name args -> ( "service-integration", Encode.object [ ( "name", Encode.string name ), ( "args", Encode.list Encode.string args ) ] )
                ServiceDeferAt unixMs channel message -> ( "service-integration", Encode.object [ ( "unixMs", Encode.float unixMs ), ( "channel", Encode.string channel ), ( "text", Encode.string message ) ] )
                ServiceDeferCron minute hour dayOfMonth month dayOfWeek channel message -> ( "service-integration", Encode.object [ ( "minute", Encode.string minute ), ( "hour", Encode.string hour ), ( "dayOfMonth", Encode.string dayOfMonth ), ( "month", Encode.string month ), ( "dayOfWeek", Encode.string dayOfWeek ), ( "channel", Encode.string channel ), ( "text", Encode.string message ) ] )
                ServiceDeferOperAt unixMs channel mode -> ( "service-integration", Encode.object [ ( "unixMs", Encode.float unixMs ), ( "channel", Encode.string channel ), ( "mode", Encode.string (String.fromChar mode) ) ] )
                ServiceDeferOperCron minute hour dayOfMonth month dayOfWeek channel mode -> ( "service-integration", Encode.object [ ( "minute", Encode.string minute ), ( "hour", Encode.string hour ), ( "dayOfMonth", Encode.string dayOfMonth ), ( "month", Encode.string month ), ( "dayOfWeek", Encode.string dayOfWeek ), ( "channel", Encode.string channel ), ( "mode", Encode.string (String.fromChar mode) ) ] )
                ServiceOutHookInput -> ( "service-integration", Encode.object [] )
                ServiceOutHookAdd inputRef -> ( "service-integration", Encode.object [ ( "inputRef", Encode.string inputRef ) ] )
                ServiceOutHookList -> ( "service-integration", Encode.object [] )
                ServiceOutHookInspect urlRef -> ( "service-integration", Encode.object [ ( "urlRef", Encode.string urlRef ) ] )
                ServiceOutHookRemove urlRef -> ( "service-integration", Encode.object [ ( "urlRef", Encode.string urlRef ), ( "confirm", Encode.bool True ) ] )
                ServiceUnfurlOff -> ( "service-integration", Encode.object [] )
                ServiceUnfurlOn -> ( "service-integration", Encode.object [] )
                ServiceUnfurlPreview url -> ( "service-integration", Encode.object [ ( "url", Encode.string url ) ] )
                ServiceMemoSend account message -> ( "service-integration", Encode.object [ ( "account", Encode.string account ), ( "text", Encode.string message ) ] )
                ServiceMemoList -> ( "service-integration", Encode.object [] )
                ServiceMemoClear -> ( "service-integration", Encode.object [ ( "confirm", Encode.bool True ) ] )
                ServiceMemoForward account -> ( "service-integration", Encode.object [ ( "account", maybeString account ) ] )
                ServiceMemoIgnoreList -> ( "service-integration", Encode.object [] )
                ServiceMemoIgnoreAdd account -> ( "service-integration", Encode.object [ ( "account", Encode.string account ) ] )
                ServiceMemoIgnoreRemove account -> ( "service-integration", Encode.object [ ( "account", Encode.string account ), ( "confirm", Encode.bool True ) ] )
                WebAuthnBegin ceremony account -> ( "webauthn", Encode.object [ ( "ceremony", Encode.string ceremony ), ( "account", Maybe.withDefault (Encode.null) (Maybe.map Encode.string account) ) ] )
                WebAuthnCancel ceremonyRef -> ( "webauthn", Encode.object [ ( "ceremonyRef", Encode.string ceremonyRef ) ] )
                NewTabIntent -> ( "tab-intent", Encode.object [ ( "confirm", Encode.bool True ) ] )
                RetireTabIntent ref -> ( "tab-intent", Encode.object [ ( "intentRef", Encode.string ref ), ( "confirm", Encode.bool True ) ] )
                ListWorkspaces -> ( "workspace", Encode.object [] )
                RememberWorkspace enabled -> ( "workspace", Encode.object [ ( "enabled", Encode.bool enabled ), ( "confirm", Encode.bool True ) ] )
                SelectWorkspace ref -> ( "workspace", Encode.object [ ( "workspaceRef", Encode.string ref ) ] )
                RegisterWorker -> ( "platform", Encode.object [] )
                InspectPush -> ( "platform", Encode.object [] )
                ListJournal -> ( "journal", Encode.object [] )
                LoadDraft conversationId -> ( "draft", Encode.object [ ( "conversationId", Encode.string conversationId ) ] )
                SaveDraft conversationId content revision -> ( "draft", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "text", Encode.string content ), ( "revision", Encode.int revision ) ] )
                SettingsPreview ref -> ( "settings", Encode.object [ ( "inputRef", Encode.string ref ) ] )
                SettingsApply ref optIns -> ( "settings", Encode.object [ ( "previewRef", Encode.string ref ), ( "enabledOptIns", Encode.list Encode.string optIns ) ] )
                StorageExport selection output -> ( "storage", Encode.object [ ( "selectionRef", Encode.string selection ), ( "outputRef", Encode.string output ) ] )
                QueueMessage conversationId intent content replyTo messageKind audiencePrefix -> ( "journal", Encode.object [ ( "clientIntentId", Encode.string (Ids.requestIdToRuntime command.requestId) ), ( "conversationId", Encode.string conversationId ), ( "intent", Encode.string intent ), ( "text", Encode.string content ), ( "replyTo", Maybe.withDefault (Encode.null) (Maybe.map Encode.string replyTo) ), ( "messageKind", Encode.string messageKind ), ( "audiencePrefix", Maybe.withDefault (Encode.null) (Maybe.map (Encode.string << String.fromChar) audiencePrefix) ) ] )
                ScheduledCreate inputRef operationId clientIntentId conversationId dueAtMs messageKind replyTo audiencePrefix ->
                    ( "scheduled"
                    , Encode.object
                        [ ( "inputRef", Encode.string inputRef )
                        , ( "operationId", Encode.string operationId )
                        , ( "clientIntentId", Encode.string (Ids.requestIdToRuntime clientIntentId) )
                        , ( "conversationId", Encode.string conversationId )
                        , ( "dueAtMs", Encode.int dueAtMs )
                        , ( "messageKind", Encode.string messageKind )
                        , ( "replyTo", Maybe.withDefault Encode.null (Maybe.map Encode.string replyTo) )
                        , ( "audiencePrefix", Maybe.withDefault Encode.null (Maybe.map (Encode.string << String.fromChar) audiencePrefix) )
                        ]
                    )
                ScheduledEdit inputRef scheduleRef expectedRevision dueAtMs messageKind replyTo audiencePrefix ->
                    ( "scheduled", Encode.object [ ( "inputRef", Encode.string inputRef ), ( "scheduleRef", Encode.string scheduleRef ), ( "expectedRevision", Encode.int expectedRevision ), ( "dueAtMs", Encode.int dueAtMs ), ( "messageKind", Encode.string messageKind ), ( "replyTo", Maybe.withDefault Encode.null (Maybe.map Encode.string replyTo) ), ( "audiencePrefix", Maybe.withDefault Encode.null (Maybe.map (Encode.string << String.fromChar) audiencePrefix) ) ] )
                ScheduledList -> ( "scheduled", Encode.object [] )
                ScheduledCancel scheduleRef expectedRevision -> ( "scheduled", Encode.object [ ( "scheduleRef", Encode.string scheduleRef ), ( "expectedRevision", Encode.int expectedRevision ) ] )
                ScheduledDispatch scheduleRef expectedRevision -> ( "scheduled", Encode.object [ ( "scheduleRef", Encode.string scheduleRef ), ( "expectedRevision", Encode.int expectedRevision ) ] )
                ScheduledReconcile scheduleRef expectedRevision -> ( "scheduled", Encode.object [ ( "scheduleRef", Encode.string scheduleRef ), ( "expectedRevision", Encode.int expectedRevision ) ] )
                RestoreSessionIntent intentRef -> ( "tab-intent", Encode.object [ ( "intentRef", Encode.string intentRef ), ( "confirm", Encode.bool True ) ] )
                RetryJournal ref -> ( "journal", Encode.object [ ( "entryRef", Encode.string ref ), ( "confirmDuplicateRisk", Encode.bool True ) ] )
                ReconcileJournal ref -> ( "journal", Encode.object [ ( "entryRef", Encode.string ref ) ] )
                CancelJournal ref -> ( "journal", Encode.object [ ( "entryRef", Encode.string ref ) ] )
                LockWorkspace -> ( "workspace", Encode.object [] )
                DraftDiscard conversationId revision -> ( "draft", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "revision", Encode.int revision ) ] )
                DraftRecoveryList -> ( "draft", Encode.object [] )
                DraftRecover draftRef -> ( "draft", Encode.object [ ( "draftRef", Encode.string draftRef ) ] )
                SettingsExport outputRef -> ( "settings", Encode.object [ ( "outputRef", Encode.string outputRef ) ] )
                StorageClear selectionRef -> ( "storage", Encode.object [ ( "selectionRef", Encode.string selectionRef ), ( "confirm", Encode.bool True ) ] )
                EvictionPreview conversationIds -> ( "eviction", Encode.object [ ( "conversationIds", Encode.list Encode.string conversationIds ) ] )
                EvictionApply planRef -> ( "eviction", Encode.object [ ( "planRef", Encode.string planRef ), ( "confirm", Encode.bool True ) ] )
                GroupDirectoryRefresh conversationId -> ( "group", Encode.object [ ( "conversationId", Encode.string conversationId ) ] )
                GroupTrustPreview conversationId accountId deviceId -> ( "group", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "accountId", Encode.string accountId ), ( "deviceId", Encode.string deviceId ) ] )
                GroupTrustConfirm ref -> ( "group", Encode.object [ ( "previewRef", Encode.string ref ), ( "confirm", Encode.bool True ) ] )
                GroupEnroll conversationId -> ( "group", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "confirm", Encode.bool True ) ] )
                GroupWelcomeRequest conversationId epoch commitHash -> ( "group", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "expectedEpoch", Encode.int epoch ), ( "expectedCommitHash", Encode.string commitHash ) ] )
                GroupCancel operationRef -> ( "group", Encode.object [ ( "operationRef", Encode.string operationRef ) ] )
                GroupBootstrapPreview conversationId -> ( "group", Encode.object [ ( "conversationId", Encode.string conversationId ) ] )
                GroupBootstrapApprove previewRef -> ( "group", Encode.object [ ( "previewRef", Encode.string previewRef ), ( "confirm", Encode.bool True ) ] )
                GroupBootstrapCancel previewRef -> ( "group", Encode.object [ ( "previewRef", Encode.string previewRef ) ] )
                GroupAuthorPlan conversationId epoch commitHash -> ( "group", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "expectedEpoch", Encode.int epoch ), ( "expectedCommitHash", Encode.string commitHash ), ( "excludeDevice", Encode.null ) ] )
                GroupAuthorCommit planRef revision -> ( "group", Encode.object [ ( "planRef", Encode.string planRef ), ( "confirmMembershipRevision", Encode.string revision ), ( "confirmBackupEnabled", Encode.bool True ) ] )
                GroupRemoveDevice conversationId accountId deviceId epoch commitHash -> ( "group", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "accountId", Encode.string accountId ), ( "deviceId", Encode.string deviceId ), ( "expectedEpoch", Encode.int epoch ), ( "expectedCommitHash", Encode.string commitHash ), ( "confirm", Encode.bool True ) ] )
                GroupBackupExport conversationId epoch commitHash outputRef passwordRef -> ( "group", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "epoch", Encode.int epoch ), ( "commitHashHex", Encode.string commitHash ), ( "outputRef", Encode.string outputRef ), ( "passwordRef", Encode.string passwordRef ) ] )
                GroupBackupImport conversationId inputRef passwordRef networkId -> ( "group", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "inputRef", Encode.string inputRef ), ( "passwordRef", Encode.string passwordRef ), ( "configuredNetworkId", Encode.string networkId ) ] )
                GroupBackupApprove previewRef fingerprint -> ( "group", Encode.object [ ( "previewRef", Encode.string previewRef ), ( "confirmHistoryOnly", Encode.bool True ), ( "confirmFingerprint", Encode.string fingerprint ) ] )
                GroupBackupCancel previewRef -> ( "group", Encode.object [ ( "previewRef", Encode.string previewRef ) ] )
                MediaJoin conversationId kind captureRef -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "kind", Encode.string kind ), ( "captureRef", Encode.string captureRef ) ] )
                MediaLeave conversationId -> ( "media", Encode.object [ ( "conversationId", Maybe.withDefault (Encode.null) (Maybe.map Encode.string conversationId) ) ] )
                MediaInspect -> ( "media", Encode.object [] )
                MediaRosterRefresh conversationId callRef -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "callRef", Encode.string callRef ) ] )
                MediaDevicesRefresh -> ( "media", Encode.object [] )
                MediaInput input -> ( "media", Encode.object [ ( "deviceRef", maybeString input.deviceRef ), ( "conversationId", maybeString input.conversationId ), ( "callRef", maybeString input.callRef ), ( "captureRef", maybeString input.captureRef ) ] )
                MediaOutput output -> ( "media", Encode.object [ ( "deviceRef", maybeString output.deviceRef ), ( "volumePercent", Encode.int output.volumePercent ) ] )
                MediaConsent request -> ( "media", Encode.object [ ( "conversationId", Encode.string request.conversationId ), ( "callRef", Encode.string request.callRef ), ( "consent", Encode.string request.consent ), ( "policyRevision", maybeString request.policyRevision ) ] )
                MediaRecord request -> ( "media", Encode.object [ ( "conversationId", Encode.string request.conversationId ), ( "callRef", Encode.string request.callRef ), ( "action", Encode.string request.action ), ( "consentRevision", maybeString request.consentRevision ) ] )
                MediaSoundcheck captureRef durationMs -> ( "media", Encode.object [ ( "captureRef", Encode.string captureRef ), ( "durationMs", Encode.int durationMs ) ] )
                MediaAudioRecover conversationId callRef -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "callRef", Encode.string callRef ) ] )
                MediaCaptionPrepare conversationId callRef language -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "callRef", Encode.string callRef ), ( "language", Encode.string language ) ] )
                MediaCaptionStart conversationId callRef language mode browserServiceConsent -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "callRef", Encode.string callRef ), ( "language", Encode.string language ), ( "mode", Encode.string mode ), ( "browserServiceConsent", Encode.bool browserServiceConsent ) ] )
                MediaCaptionStop conversationId callRef -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "callRef", Encode.string callRef ) ] )
                MediaMute muted -> ( "media", Encode.object [ ( "muted", Encode.bool muted ) ] )
                MediaDeafen deafened -> ( "media", Encode.object [ ( "deafened", Encode.bool deafened ) ] )
                MediaCameraPreview conversationId captureRef -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "captureRef", Encode.string captureRef ) ] )
                MediaCameraPublish conversationId previewRef -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "previewRef", Encode.string previewRef ) ] )
                MediaQuality conversationId callRef policy -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "callRef", Encode.string callRef ), ( "policy", Encode.string policy ) ] )
                MediaPreviewRetire previewRef -> ( "media", Encode.object [ ( "previewRef", Encode.string previewRef ) ] )
                MediaScreenStart conversationId captureRef -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ), ( "captureRef", Encode.string captureRef ) ] )
                MediaScreenStop conversationId -> ( "media", Encode.object [ ( "conversationId", Encode.string conversationId ) ] )
                MediaWebRtcRun captureRef kind -> ( "media", Encode.object [ ( "captureRef", Encode.string captureRef ), ( "kind", Encode.string kind ) ] )
                MediaWebRtcStop experimentRef -> ( "media", Encode.object [ ( "experimentRef", Encode.string experimentRef ) ] )
                AnchorViewed conversationId messageId timestamp ->
                    ( "anchor"
                    , Encode.object
                        [ ( "conversationId", Encode.string conversationId )
                        , ( "messageId", Maybe.withDefault (Encode.null) (Maybe.map Encode.string messageId) )
                        , ( "timestamp", Maybe.withDefault (Encode.null) (Maybe.map Encode.string timestamp) )
                        ]
                    )
                AnchorLoad conversationId -> ( "anchor", Encode.object [ ( "conversationId", Encode.string conversationId ) ] )
                PushEnable consentRef -> ( "platform", Encode.object [ ( "consentRef", Encode.string consentRef ) ] )
                PushDisable -> ( "platform", Encode.object [ ( "confirm", Encode.bool True ) ] )
                PushReconcile -> ( "platform", Encode.object [] )
                WorkerActivate targetRef -> ( "platform", Encode.object [ ( "targetRef", Encode.string targetRef ), ( "confirm", Encode.bool True ) ] )
                WorkerCancel activationRef -> ( "platform", Encode.object [ ( "activationRef", Encode.string activationRef ) ] )
                WebTransportFallback attemptRef -> ( "integration", Encode.object [ ( "attemptRef", Encode.string attemptRef ), ( "confirm", Encode.bool True ) ] )
                ReconnectMedia -> ( "integration", Encode.object [ ( "confirm", Encode.bool True ) ] )
                OperatorImportPreview inputRef -> ( "operator-import", Encode.object [ ( "inputRef", Encode.string inputRef ) ] )
                OperatorImportDismiss previewRef -> ( "operator-import", Encode.object [ ( "previewRef", Encode.string previewRef ) ] )
                OperatorImportGet previewRef -> ( "operator-import", Encode.object [ ( "previewRef", Encode.string previewRef ) ] )
                WebTransportConnect ref -> ( "integration", Encode.object [ ( "endpointRef", Encode.string ref ), ( "confirm", Encode.bool True ) ] )
    in
    Encode.object
        [ ( "schemaVersion", Encode.int 1 )
        , ( "requestId", Encode.string (Ids.requestIdToRuntime command.requestId) )
        , ( "ownerRef", Encode.string (Ids.ownerRefToRuntime command.ownerRef) )
        , ( "accountGeneration", Encode.int (Ids.accountGenerationToInt command.accountGeneration) )
        , ( "connectionGeneration", Encode.int (Ids.connectionGenerationToInt command.connectionGeneration) )
        , ( "domain", Encode.string domain )
        , ( "action", Encode.string (actionName command.action) )
        , ( "payload", payload )
        ]


maybeString : Maybe String -> Encode.Value
maybeString value =
    Maybe.withDefault Encode.null (Maybe.map Encode.string value)


decodeResult : Decode.Decoder ResultView
decodeResult =
    Decode.map8
        (\requestId ownerRef accountGeneration connectionGeneration domain action status completionScope ->
            { requestId = requestId, ownerRef = ownerRef, accountGeneration = accountGeneration
            , connectionGeneration = connectionGeneration, domain = domain, action = action
            , status = status, completionScope = completionScope, reason = Nothing, items = [], draftTarget = Nothing, draftText = Nothing, draftRevision = Nothing, selectedContinuationRef = Nothing
            , anchorTarget = Nothing, anchorAcceptedTimestamp = Nothing, anchorViewedCandidate = Nothing
            , scheduledMode = Nothing, scheduledLegacyHeldCount = 0, scheduledLegacyReviewUnavailable = False, scheduledViewReady = False, scheduledItems = []
            , sessionRecovery = Nothing, passkeyManagement = Nothing
            , sessionInventory = Nothing, sessionRevocation = Nothing, accountCommunity = Nothing, serviceIntegration = Nothing, draftRecovery = Nothing, mediaQuality = Nothing, mediaControl = Nothing
            }
        )
        (Decode.field "requestId" Decode.string |> Decode.andThen (validated Ids.requestIdFromRuntime "request id"))
        (Decode.field "ownerRef" Decode.string |> Decode.andThen (validated Ids.ownerRefFromRuntime "owner ref"))
        (Decode.field "accountGeneration" Decode.int |> Decode.andThen (validated Ids.accountGenerationFromInt "account generation"))
        (Decode.field "connectionGeneration" Decode.int |> Decode.andThen (validated Ids.connectionGenerationFromInt "connection generation"))
        (Decode.field "domain" Decode.string |> Decode.andThen domainDecoder)
        (Decode.field "action" Decode.string |> Decode.andThen actionDecoder)
        (Decode.field "status" Decode.string |> Decode.andThen statusDecoder)
        (Decode.field "completionScope" Decode.string |> Decode.andThen scopeDecoder)
        |> Decode.andThen
            (\base ->
                Decode.map
                    (\reason -> { base | reason = reason })
                    (Decode.field "reason" (Decode.nullable safeReasonDecoder))
            )
        |> Decode.andThen
            (\base ->
                Decode.field "view" (Decode.nullable Decode.value)
                    |> Decode.andThen
                        (\maybeView ->
                            case maybeView of
                                Nothing -> Decode.succeed { base | items = [] }

                                Just view ->
                                    case Decode.decodeValue (Decode.field "kind" Decode.string) view of
                                        Ok kind ->
                                            if (kind == "session-recovery" && Result.toMaybe (decodeSessionRecoveryView view) == Nothing)
                                                || (kind == "passkey-management" && Result.toMaybe (decodePasskeyManagementView view) == Nothing)
                                                || (kind == "session-inventory" && Result.toMaybe (decodeSessionInventoryView view) == Nothing)
                                                || (kind == "session-revocation" && Result.toMaybe (decodeSessionRevocationView view) == Nothing)
                                                || (kind == "account-community" && Result.toMaybe (decodeAccountCommunityView view) == Nothing)
                                                || (kind == "service-integration" && Result.toMaybe (decodeServiceIntegrationView view) == Nothing)
                                                || (kind == "draft-recovery" && Result.toMaybe (decodeDraftRecoveryView view) == Nothing)
                                                || (kind == "media-quality" && Result.toMaybe (decodeMediaQualityView view) == Nothing)
                                                || (kind == "media" && Result.toMaybe (decodeMediaControlView view) == Nothing) then
                                                Decode.fail "invalid typed private view"

                                            else if (kind == base.domain || (base.domain == "draft" && List.member kind [ "storage", "draft-recovery" ]) || (base.domain == "session" && List.member kind [ "session-recovery", "session-inventory", "session-revocation" ]) || (base.domain == "account-security" && kind == "passkey-management") || (base.domain == "account-community" && kind == "account-community") || (base.domain == "service-integration" && kind == "service-integration") || (base.domain == "media" && List.member kind [ "media-quality", "media" ])) then
                                                Decode.succeed
                                                    { base
                                                        | items =
                                                            let
                                                                decoded = decodeSafeItems base.domain view
                                                                selected = Decode.decodeValue (Decode.field "selectedContinuationRef" (Decode.nullable boundedText)) view |> Result.toMaybe |> Maybe.withDefault Nothing
                                                            in
                                                            if base.domain == "continuation" then
                                                                List.map (\item -> if Just item.ref == selected then { item | state = if item.state == "usable" then "selected" else "selected-unavailable" } else item) decoded
                                                            else
                                                                decoded
                                                        , draftTarget = if base.domain == "draft" && base.action == "load" then Decode.decodeValue (Decode.at [ "draft", "conversationId" ] boundedText) view |> Result.toMaybe else Nothing
                                                        , draftText = if base.domain == "draft" && base.action == "load" then Decode.decodeValue (Decode.at [ "draft", "text" ] (Decode.nullable boundedDraftText)) view |> Result.toMaybe |> Maybe.withDefault Nothing else Nothing
                                                        , draftRevision = if base.domain == "draft" && base.action == "load" then Decode.decodeValue (Decode.at [ "draft", "revision" ] (Decode.int |> Decode.andThen (\value -> if value >= 0 then Decode.succeed value else Decode.fail "invalid draft revision"))) view |> Result.toMaybe else Nothing
                                                        , selectedContinuationRef = if base.domain == "continuation" then Decode.decodeValue (Decode.field "selectedContinuationRef" (Decode.nullable boundedText)) view |> Result.toMaybe |> Maybe.withDefault Nothing else Nothing
                                                        , anchorTarget = if base.domain == "anchor" then Decode.decodeValue (Decode.field "conversationId" boundedText) view |> Result.toMaybe else Nothing
                                                        , anchorAcceptedTimestamp = if base.domain == "anchor" then Decode.decodeValue (Decode.field "acceptedTimestamp" (Decode.nullable readMarkerTimestampDecoder)) view |> Result.toMaybe |> Maybe.withDefault Nothing else Nothing
                                                        , anchorViewedCandidate = if base.domain == "anchor" then Decode.decodeValue (Decode.field "viewedCandidate" (Decode.nullable readMarkerTimestampDecoder)) view |> Result.toMaybe |> Maybe.withDefault Nothing else Nothing
                                                        , scheduledMode = if base.domain == "scheduled" then Decode.decodeValue (Decode.field "mode" (Decode.string |> Decode.andThen (\mode -> if List.member mode [ "durable", "volatile" ] then Decode.succeed mode else Decode.fail "invalid scheduled mode"))) view |> Result.toMaybe else Nothing
                                                        , scheduledLegacyHeldCount = if base.domain == "scheduled" then Decode.decodeValue (Decode.field "legacyHeldCount" (Decode.int |> Decode.andThen (\count -> if count >= 0 && count <= 100000 then Decode.succeed count else Decode.fail "invalid legacy count"))) view |> Result.toMaybe |> Maybe.withDefault 0 else 0
                                                        , scheduledLegacyReviewUnavailable = if base.domain == "scheduled" then Decode.decodeValue (Decode.field "legacyReviewUnavailable" Decode.bool) view |> Result.toMaybe |> Maybe.withDefault True else False
                                                        , scheduledItems = if base.domain == "scheduled" then decodeScheduledItems view else []
                                                        , scheduledViewReady =
                                                            base.domain /= "scheduled"
                                                                || (Decode.decodeValue
                                                                        (Decode.map4 (\_ _ _ _ -> True)
                                                                            (Decode.field "mode" (Decode.string |> Decode.andThen (\mode -> if List.member mode [ "durable", "volatile" ] then Decode.succeed mode else Decode.fail "invalid scheduled mode")))
                                                                            (Decode.field "legacyHeldCount" (Decode.int |> Decode.andThen (\count -> if count >= 0 && count <= 100000 then Decode.succeed count else Decode.fail "invalid legacy count")))
                                                                            (Decode.field "legacyReviewUnavailable" Decode.bool)
                                                                            (Decode.field "items"
                                                                                (Decode.list
                                                                                    scheduledItemDecoder
                                                                                    |> Decode.andThen (\items -> if List.length items <= 256 then Decode.succeed True else Decode.fail "too many scheduled items")
                                                                                )
                                                                            )
                                                                        )
                                                                        view
                                                                        |> Result.toMaybe
                                                                        |> Maybe.withDefault False
                                                                   )
                                                        , sessionRecovery = if kind == "session-recovery" then decodeSessionRecoveryView view |> Result.toMaybe else Nothing
                                                        , passkeyManagement = if kind == "passkey-management" then decodePasskeyManagementView view |> Result.toMaybe else Nothing
                                                        , sessionInventory = if kind == "session-inventory" then decodeSessionInventoryView view |> Result.toMaybe else Nothing
                                                        , sessionRevocation = if kind == "session-revocation" then decodeSessionRevocationView view |> Result.toMaybe else Nothing
                                                        , accountCommunity = if kind == "account-community" then decodeAccountCommunityView view |> Result.toMaybe else Nothing
                                                        , serviceIntegration = if kind == "service-integration" then decodeServiceIntegrationView view |> Result.toMaybe else Nothing
                                                        , draftRecovery = if kind == "draft-recovery" then decodeDraftRecoveryView view |> Result.toMaybe else Nothing
                                                        , mediaQuality = if kind == "media-quality" then decodeMediaQualityView view |> Result.toMaybe else Nothing
                                                        , mediaControl = if kind == "media" then decodeMediaControlView view |> Result.toMaybe else Nothing
                                                    }
                                            else
                                                Decode.fail "domain view kind mismatch"

                                        Err _ ->
                                            Decode.fail "invalid domain view"
                        )
            )
        |> Decode.andThen
            (\result ->
                Decode.field "schemaVersion" Decode.int
                    |> Decode.andThen (\version -> if version == 1 && validPair result.domain result.action then Decode.succeed result else Decode.fail "unsupported domain result version or route")
            )


decodeSessionRecoveryView : Decode.Value -> Result Decode.Error SessionRecoveryView
decodeSessionRecoveryView value =
    Decode.decodeValue
        (Decode.map8 SessionRecoveryView
            (Decode.field "requestId" (runtimeIdDecoder Ids.requestIdFromRuntime Ids.requestIdToRuntime "request id"))
            (Decode.field "credentialRef" (runtimeIdDecoder Ids.credentialRefFromRuntime Ids.credentialRefToRuntime "credential ref"))
            (Decode.field "status" (enumDecoder [ "pending", "transport-admitted", "blocked", "unknown", "redirecting", "awaiting-authentication", "accepted", "rejected" ]))
            (Decode.field "outcome" (Decode.nullable (enumDecoder [ "exact-restored", "logical-attached", "legacy-new-attachment", "attachment-in-use", "missing", "revoked", "invalid", "retryable", "redirect", "unknown" ])))
            (Decode.field "reason" (Decode.nullable (enumDecoder [ "invalid-request", "busy", "credential-unavailable", "credential-expired", "owner-changed", "account-proof-required", "offline", "backpressure", "local-policy", "transport-error", "response-timeout", "untrusted-redirect", "redirect-loop", "redirect-limit", "kind-mismatch", "server-rejected" ])))
            (Decode.field "redirectNode" (Decode.nullable (Decode.string |> Decode.andThen (\node -> if String.length node > 0 && String.length node <= 128 && String.all redirectNodeChar node then Decode.succeed node else Decode.fail "invalid redirect node"))))
            (Decode.field "hopCount" (Decode.int |> Decode.andThen (\count -> if count >= 0 && count <= 3 then Decode.succeed count else Decode.fail "invalid redirect count")))
            (Decode.field "transferFrom" (Decode.nullable transferStampDecoder))
        )
        value


decodePasskeyManagementView : Decode.Value -> Result Decode.Error PasskeyManagementView
decodePasskeyManagementView value =
    Decode.decodeValue
        (Decode.map5 PasskeyManagementView
            (Decode.field "requestId" (runtimeIdDecoder Ids.requestIdFromRuntime Ids.requestIdToRuntime "request id"))
            (Decode.field "status" (enumDecoder [ "idle", "pending", "ready", "rejected", "unknown" ]))
            (Decode.field "operation" (Decode.nullable (enumDecoder [ "list", "rename", "remove" ])))
            (Decode.field "rows" (Decode.list passkeyRowDecoder |> Decode.andThen (\rows -> if List.length rows <= 16 then Decode.succeed rows else Decode.fail "too many passkeys")))
            (Decode.field "reason" (Decode.nullable (enumDecoder [ "invalid-request", "owner-changed", "account-proof-required", "busy", "offline", "backpressure", "local-policy", "transport-error", "response-timeout", "invalid-list", "not-owned", "not-found", "label-invalid", "server-rejected" ])))
        )
        value


decodeSessionInventoryView : Decode.Value -> Result Decode.Error SessionInventoryView
decodeSessionInventoryView value =
    Decode.decodeValue
        (Decode.map8
            (\requestId mode status scanRef localRows meshRows continuationAvailable scanComplete ->
                { requestId = requestId
                , mode = mode
                , status = status
                , scanRef = scanRef
                , localRows = localRows
                , meshRows = meshRows
                , continuationAvailable = continuationAvailable
                , scanComplete = scanComplete
                , pageCount = 0
                , lastObservedAt = Nothing
                , reason = Nothing
                }
            )
            (Decode.field "requestId" (runtimeIdDecoder Ids.requestIdFromRuntime Ids.requestIdToRuntime "request id"))
            (Decode.field "mode" (enumDecoder [ "local", "mesh" ]))
            (Decode.field "status" (enumDecoder [ "idle", "pending", "ready", "partial", "stale", "unknown", "unsupported", "failed" ]))
            (Decode.field "scanRef" (Decode.nullable opaqueRefDecoder))
            (Decode.field "localRows" (Decode.list sessionLocalRowDecoder |> Decode.andThen (boundedList 4096 "too many local session rows")))
            (Decode.field "meshRows" (Decode.list sessionMeshRowDecoder |> Decode.andThen (boundedList 4096 "too many mesh session rows")))
            (Decode.field "continuationAvailable" Decode.bool)
            (Decode.field "scanComplete" Decode.bool)
        |> Decode.andThen
            (\base ->
                Decode.map3
                    (\pageCount lastObservedAt reason ->
                        { base | pageCount = pageCount, lastObservedAt = lastObservedAt, reason = reason }
                    )
                    (Decode.field "pageCount" (Decode.int |> Decode.andThen (boundedInteger 0 128 "page count")))
                    (Decode.field "lastObservedAt" (Decode.nullable canonicalNonnegativeI64Decoder))
                    (Decode.field "reason" (Decode.nullable (enumDecoder sessionInventoryReasons)))
                    |> Decode.andThen
                        (\completed ->
                            if (base.mode == "local" && not (List.isEmpty base.meshRows))
                                || (base.mode == "mesh" && not (List.isEmpty base.localRows)) then
                                Decode.fail "session inventory row mode mismatch"

                            else
                                Decode.succeed completed
                        )
            )
        )
        value


sessionInventoryReasons : List String
sessionInventoryReasons =
    [ "invalid-request", "owner-changed", "account-proof-required", "offline", "busy", "backpressure"
    , "transport-error", "response-timeout", "invalid-response", "unsupported", "stale-list", "inventory-limit"
    , "no-such-session", "ambiguous-group", "temporarily-unavailable", "server-rejected", "dismissed"
    ]


decodeSessionRevocationView : Decode.Value -> Result Decode.Error SessionRevocationView
decodeSessionRevocationView value =
    Decode.decodeValue
        (Decode.map5 SessionRevocationView
            (Decode.field "requestId" (runtimeIdDecoder Ids.requestIdFromRuntime Ids.requestIdToRuntime "request id"))
            (Decode.field "revokeRef" opaqueRefDecoder)
            (Decode.field "groupRef" opaqueRefDecoder)
            (Decode.field "status" (enumDecoder [ "requesting", "preflight-pending", "local-denial-committed", "completion-unknown", "complete", "rejected", "unsupported" ]))
            (Decode.field "reason" (Decode.nullable (enumDecoder sessionInventoryReasons)))
        )
        value


decodeAccountCommunityView : Decode.Value -> Result Decode.Error AccountCommunityView
decodeAccountCommunityView value =
    Decode.decodeValue
        (Decode.map4
            (\requestId section status operation ->
                { requestId = requestId
                , section = section
                , status = status
                , operation = operation
                , autojoinRows = []
                , groupRows = []
                , reason = Nothing
                }
            )
            (Decode.field "requestId" (runtimeIdDecoder Ids.requestIdFromRuntime Ids.requestIdToRuntime "request id"))
            (Decode.field "section" (enumDecoder [ "autojoin", "nick-group" ]))
            (Decode.field "status" (enumDecoder [ "idle", "pending", "ready", "unknown", "rejected", "unsupported" ]))
            (Decode.field "operation" (enumDecoder [ "list", "add", "remove", "primary" ]))
        |> Decode.andThen
            (\base ->
                Decode.map3
                    (\autojoinRows groupRows reason -> { base | autojoinRows = autojoinRows, groupRows = groupRows, reason = reason })
                    (Decode.field "autojoinRows" (Decode.list autojoinRowDecoder |> Decode.andThen (boundedList 64 "too many autojoin rows")))
                    (Decode.field "groupRows" (Decode.list accountCommunityGroupRowDecoder |> Decode.andThen (boundedList 16 "too many account groups")))
                    (Decode.field "reason" (Decode.nullable (enumDecoder accountCommunityReasons)))
                    |> Decode.andThen
                        (\completed ->
                            if (base.section == "autojoin" && not (List.isEmpty completed.groupRows))
                                || (base.section == "nick-group" && not (List.isEmpty completed.autojoinRows)) then
                                Decode.fail "account community row section mismatch"

                            else
                                Decode.succeed completed
                        )
            )
        )
        value


accountCommunityReasons : List String
accountCommunityReasons =
    [ "invalid-request", "owner-changed", "account-proof-required", "busy", "offline", "backpressure"
    , "transport-error", "response-timeout", "invalid-response", "server-rejected", "unsupported"
    ]


decodeServiceIntegrationView : Decode.Value -> Result Decode.Error ServiceIntegrationView
decodeServiceIntegrationView value =
    Decode.decodeValue
        ((Decode.map8
            (\requestId feature operation phase registry effectiveFeature accountProof authorization ->
                { requestId = requestId
                , feature = feature
                , operation = operation
                , phase = phase
                , registry = registry
                , effectiveFeature = effectiveFeature
                , accountProof = accountProof
                , authorization = authorization
                , reason = Nothing
                , rows = []
                , inputRef = Nothing
                }
            )
            (Decode.field "requestId" (runtimeIdDecoder Ids.requestIdFromRuntime Ids.requestIdToRuntime "request id"))
            (Decode.field "feature" (enumDecoder [ "webhook", "outhook", "botgrant", "botcmd", "defer", "unfurl", "memo" ]))
            (Decode.field "operation" (Decode.nullable Decode.string))
            (Decode.field "phase" (enumDecoder [ "idle", "pending", "accepted", "rejected", "unknown", "unsupported", "blocked" ]))
            (Decode.field "registry" (enumDecoder [ "enabled", "disabled", "unknown" ]))
            (Decode.field "effectiveFeature" (enumDecoder [ "enabled", "disabled", "unknown" ]))
            (Decode.field "accountProof" (enumDecoder [ "required", "satisfied", "unknown" ]))
            (Decode.field "authorization" (enumDecoder [ "allowed", "denied", "unknown" ]))
        )
            |> Decode.andThen
            (\base ->
                let
                    operationDecoder operation =
                        if List.member operation (serviceIntegrationOperations base.feature) then
                            Decode.succeed operation

                        else
                            Decode.fail "invalid integration operation for feature"
                in
                Decode.map4
                    (\operation reason rows inputRef -> { base | operation = operation, reason = reason, rows = rows, inputRef = inputRef })
                    (Decode.field "operation" (Decode.nullable (Decode.string |> Decode.andThen operationDecoder)))
                    (Decode.field "reason" (Decode.nullable (enumDecoder serviceIntegrationReasons)))
                    (Decode.field "rows" (Decode.list serviceIntegrationRowDecoder |> Decode.andThen (boundedList 128 "too many integration rows")))
                    (Decode.field "inputRef" (Decode.nullable opaqueRefDecoder))
            )
        )
        value


serviceIntegrationRowDecoder : Decode.Decoder ServiceIntegrationRow
serviceIntegrationRowDecoder =
    Decode.map4 ServiceIntegrationRow
        (Decode.field "kind" (enumDecoder [ "entry", "status" ]))
        (Decode.field "label" (Decode.string |> Decode.andThen (boundedTextLength 1 128 "invalid integration row label")))
        (Decode.field "value" (Decode.nullable (Decode.string |> Decode.andThen (boundedTextLength 0 512 "invalid integration row value"))))
        (Decode.field "ref" (Decode.nullable opaqueRefDecoder))


serviceIntegrationReasons : List String
serviceIntegrationReasons =
    [ "invalid-request", "owner-changed", "account-proof-required", "feature-disabled", "feature-unknown", "registry-disabled", "busy", "offline", "backpressure", "transport-error", "response-timeout", "invalid-response", "permission-denied", "server-rejected", "input-expired", "input-invalid" ]


serviceIntegrationOperations : String -> List String
serviceIntegrationOperations feature =
    case feature of
        "botgrant" ->
            [ "list", "add", "remove" ]

        "botcmd" ->
            [ "list", "add", "run" ]

        "defer" ->
            [ "at", "cron", "oper-at", "oper-cron" ]

        "outhook" ->
            [ "input", "add", "list", "inspect", "remove" ]

        "unfurl" ->
            [ "off", "on", "preview" ]

        "memo" ->
            [ "send", "list", "clear", "forward", "ignore-list", "ignore-add", "ignore-remove" ]

        "webhook" ->
            [ "list" ]

        _ ->
            []


decodeDraftRecoveryView : Decode.Value -> Result Decode.Error DraftRecoveryView
decodeDraftRecoveryView value =
    Decode.decodeValue
        (Decode.map6
            (\requestId status items recovered truncated reason ->
                { requestId = requestId, status = status, items = items, recovered = recovered, truncated = truncated, reason = reason }
            )
            (Decode.field "requestId" (runtimeIdDecoder Ids.requestIdFromRuntime Ids.requestIdToRuntime "request id"))
            (Decode.field "status" (enumDecoder [ "ready", "pending", "unavailable", "stale", "invalid" ]))
            (Decode.field "items" (Decode.list draftRecoveryItemDecoder |> Decode.andThen (boundedList 100 "too many draft recovery rows")))
            (Decode.field "recovered" (Decode.nullable draftRecoveredDecoder))
            (Decode.field "truncated" Decode.bool)
            (Decode.field "reason" (Decode.nullable (enumDecoder draftRecoveryReasons)))
        )
        value


draftRecoveryReasons : List String
draftRecoveryReasons =
    [ "workspace-unavailable", "owner-changed", "selection-expired", "revision-changed", "storage-unavailable", "invalid-ciphertext" ]


decodeMediaQualityView : Decode.Value -> Result Decode.Error MediaQualityView
decodeMediaQualityView value =
    Decode.decodeValue
        (Decode.map7 MediaQualityView
            (Decode.field "requestId" (runtimeIdDecoder Ids.requestIdFromRuntime Ids.requestIdToRuntime "request id"))
            (Decode.field "conversationId" (Decode.string |> Decode.andThen (boundedTextLength 1 512 "invalid media conversation")))
            (Decode.field "callRef" opaqueRefDecoder)
            (Decode.field "desiredPolicy" (enumDecoder [ "auto", "balanced", "audio-priority" ]))
            (Decode.field "observedNetworkTier" (Decode.nullable (Decode.int |> Decode.andThen (boundedInteger 0 3 "invalid network tier"))))
            (Decode.field "observedAudioQuality" (Decode.nullable (Decode.int |> Decode.andThen (boundedInteger 0 2 "invalid audio quality"))))
            (Decode.field "videoState" (enumDecoder [ "inactive", "encoding", "audio-only", "unknown" ]))
        )
        value


mediaDeviceChoiceDecoder : Decode.Decoder MediaDeviceChoice
mediaDeviceChoiceDecoder =
    Decode.map2 MediaDeviceChoice
        (Decode.field "ref" opaqueRefDecoder)
        (Decode.field "label" (Decode.string |> Decode.andThen (boundedTextLength 1 128 "invalid device label")))


mediaDeviceViewDecoder : Decode.Decoder MediaDeviceView
mediaDeviceViewDecoder =
    Decode.map8
        (\inputs outputs selectedInputRef requestedInputRef appliedInputRef inputState inputReason selectedOutputRef ->
            { inputs = inputs, outputs = outputs, selectedInputRef = selectedInputRef, requestedInputRef = requestedInputRef
            , appliedInputRef = appliedInputRef, inputState = inputState, inputReason = inputReason
            , selectedOutputRef = selectedOutputRef, requestedOutputRef = Nothing, appliedOutputRef = Nothing
            , outputState = "idle", outputReason = Nothing, requestedVolumePercent = 0, appliedVolumePercent = Nothing
            }
        )
        (Decode.field "inputs" (Decode.list mediaDeviceChoiceDecoder |> Decode.andThen (boundedList 128 "too many input devices")))
        (Decode.field "outputs" (Decode.list mediaDeviceChoiceDecoder |> Decode.andThen (boundedList 128 "too many output devices")))
        (Decode.field "selectedInputRef" (Decode.nullable opaqueRefDecoder))
        (Decode.field "requestedInputRef" (Decode.nullable opaqueRefDecoder))
        (Decode.field "appliedInputRef" (Decode.nullable opaqueRefDecoder))
        (Decode.field "inputState" (enumDecoder [ "idle", "pending", "applied", "deferred", "unknown", "rejected" ]))
        (Decode.field "inputReason" (Decode.nullable boundedText))
        (Decode.field "selectedOutputRef" (Decode.nullable opaqueRefDecoder))
        |> Decode.andThen
            (\partial ->
                Decode.map7
                    (\requestedOutputRef appliedOutputRef outputState outputReason requestedVolumePercent appliedVolumePercent _ ->
                        { partial | requestedOutputRef = requestedOutputRef, appliedOutputRef = appliedOutputRef, outputState = outputState
                        , outputReason = outputReason, requestedVolumePercent = requestedVolumePercent, appliedVolumePercent = appliedVolumePercent
                        }
                    )
                    (Decode.field "requestedOutputRef" (Decode.nullable opaqueRefDecoder))
                    (Decode.field "appliedOutputRef" (Decode.nullable opaqueRefDecoder))
                    (Decode.field "outputState" (enumDecoder [ "idle", "pending", "applied", "deferred", "unknown", "rejected" ]))
                    (Decode.field "outputReason" (Decode.nullable boundedText))
                    (Decode.field "requestedVolumePercent" (Decode.int |> Decode.andThen (boundedInteger 0 100 "invalid requested volume")))
                    (Decode.field "appliedVolumePercent" (Decode.nullable (Decode.int |> Decode.andThen (boundedInteger 0 100 "invalid applied volume"))))
                    (Decode.succeed ())
            )


mediaSoundcheckDecoder : Decode.Decoder MediaSoundcheckView
mediaSoundcheckDecoder =
    Decode.map3 MediaSoundcheckView
        (Decode.field "state" (enumDecoder [ "input-signal-detected", "silence", "permission-denied", "unavailable", "stale-owner" ]))
        (Decode.field "rms" (Decode.nullable (Decode.float |> Decode.andThen (boundedFloat 0 1 "invalid soundcheck RMS"))))
        (Decode.field "sampledFrames" (Decode.int |> Decode.andThen (boundedInteger 0 10000000 "invalid soundcheck frame count")))


mediaRecordingDecoder : Decode.Decoder MediaRecordingView
mediaRecordingDecoder =
    Decode.map8
        (\ownConsent consentRequest desiredAction requestState actual rosterState allConsented policyRevision ->
            { ownConsent = ownConsent, consentRequest = consentRequest, desiredAction = desiredAction, requestState = requestState
            , actual = actual, rosterState = rosterState, allConsented = allConsented, policyRevision = policyRevision, reason = Nothing
            }
        )
        (Decode.field "ownConsent" (enumDecoder [ "unknown", "granted", "denied" ]))
        (Decode.field "consentRequest" (enumDecoder [ "idle", "pending", "unknown", "rejected" ]))
        (Decode.field "desiredAction" (Decode.nullable (enumDecoder [ "start", "stop" ])))
        (Decode.field "requestState" (enumDecoder [ "idle", "pending", "unknown", "rejected" ]))
        (Decode.field "actual" (enumDecoder [ "unknown", "inactive", "active" ]))
        (Decode.field "rosterState" (enumDecoder [ "unknown", "pending", "complete", "stale" ]))
        (Decode.field "allConsented" (Decode.nullable Decode.bool))
        (Decode.field "policyRevision" (Decode.nullable opaqueRefDecoder))
        |> Decode.andThen
            (\partial -> Decode.map (\reason -> { partial | reason = reason }) (Decode.field "reason" (Decode.nullable boundedText)))


mediaTelemetryDecoder : Decode.Decoder MediaTelemetryView
mediaTelemetryDecoder =
    Decode.map8
        (\sampledAt counters1 counters2 counters3 counters4 counters5 counters6 counters7 ->
            { sampledAtMonotonicMs = sampledAt
            , counters = [ ( "audioUnderruns", counters1 ), ( "queuedAudioFrames", counters2 ), ( "lateAudioFrames", counters3 ), ( "droppedAudioFrames", counters4 ), ( "droppedVideoFrames", counters5 ), ( "encodedAudioFrames", counters6 ), ( "decodedAudioFrames", counters7 ) ]
            , availability = "unavailable", reason = Nothing
            }
        )
        (Decode.field "sampledAtMonotonicMs" (Decode.float |> Decode.andThen (boundedFloat 0 9007199254740991 "invalid telemetry time")))
        (Decode.at [ "counters", "audioUnderruns" ] mediaCounterDecoder)
        (Decode.at [ "counters", "queuedAudioFrames" ] mediaCounterDecoder)
        (Decode.at [ "counters", "lateAudioFrames" ] mediaCounterDecoder)
        (Decode.at [ "counters", "droppedAudioFrames" ] mediaCounterDecoder)
        (Decode.at [ "counters", "droppedVideoFrames" ] mediaCounterDecoder)
        (Decode.at [ "counters", "encodedAudioFrames" ] mediaCounterDecoder)
        (Decode.at [ "counters", "decodedAudioFrames" ] mediaCounterDecoder)
        |> Decode.andThen
            (\partial ->
                Decode.map4
                    (\encodedVideo decodedVideo availability reason ->
                        { partial | counters = partial.counters ++ [ ( "encodedVideoFrames", encodedVideo ), ( "decodedVideoFrames", decodedVideo ) ], availability = availability, reason = reason }
                    )
                    (Decode.at [ "counters", "encodedVideoFrames" ] mediaCounterDecoder)
                    (Decode.at [ "counters", "decodedVideoFrames" ] mediaCounterDecoder)
                    (Decode.field "availability" (enumDecoder [ "observed", "partial", "unavailable" ]))
                    (Decode.field "reason" (Decode.nullable (enumDecoder [ "counter-source-unavailable", "counter-read-failed" ])))
            )


mediaCounterDecoder : Decode.Decoder (Maybe Float)
mediaCounterDecoder =
    Decode.nullable (Decode.float |> Decode.andThen (boundedFloat 0 9007199254740991 "invalid media counter"))


mediaCaptionDecoder : Decode.Decoder MediaCaptionView
mediaCaptionDecoder =
    Decode.map7
        (\conversationId callRef state reason mode language source ->
            { conversationId = conversationId, callRef = callRef, state = state, reason = reason, mode = mode, language = language
            , source = source, accuracy = Nothing, interimText = Nothing, serverVisible = True
            }
        )
        (Decode.field "conversationId" (Decode.string |> Decode.andThen (boundedTextLength 1 512 "invalid caption room")))
        (Decode.field "callRef" opaqueRefDecoder)
        (Decode.field "state" (enumDecoder [ "idle", "preparing", "ready", "listening", "unavailable", "failed", "stopped" ]))
        (Decode.field "reason" (Decode.nullable boundedText))
        (Decode.field "mode" (Decode.nullable (enumDecoder [ "local", "browser-service" ])))
        (Decode.field "language" (Decode.nullable (Decode.string |> Decode.andThen (boundedTextLength 1 64 "invalid caption language"))))
        (Decode.field "source" (Decode.nullable (enumDecoder [ "local-participant-microphone", "browser-service" ])))
        |> Decode.andThen
            (\partial ->
                Decode.map3
                    (\accuracy interim serverVisible -> { partial | accuracy = accuracy, interimText = interim, serverVisible = serverVisible })
                    (Decode.field "accuracy" (Decode.nullable (enumDecoder [ "unknown" ])))
                    (Decode.field "interimText" (Decode.nullable (Decode.string |> Decode.andThen (boundedTextLength 0 4096 "caption text too long"))))
                    (Decode.field "serverVisible" Decode.bool |> Decode.andThen (\visible -> if visible then Decode.succeed True else Decode.fail "caption visibility must be explicit"))
            )


mediaWebRtcDecoder : Decode.Decoder MediaWebRtcView
mediaWebRtcDecoder =
    Decode.map7
        (\scope reason connectionState bytes packets frames durationMs ->
            { scope = scope, reason = reason, connectionState = connectionState, bytes = bytes, packets = packets, frames = frames, durationMs = durationMs
            }
        )
        (Decode.field "scope" (Decode.string |> Decode.andThen (\scope -> if scope == "same-browser-loopback" then Decode.succeed scope else Decode.fail "invalid WebRTC scope")))
        (Decode.field "reason" (Decode.nullable boundedText))
        (Decode.field "connectionState" (Decode.nullable boundedText))
        (Decode.field "bytes" (Decode.nullable (Decode.float |> Decode.andThen (boundedFloat 0 9007199254740991 "invalid WebRTC bytes"))))
        (Decode.field "packets" (Decode.nullable (Decode.float |> Decode.andThen (boundedFloat 0 9007199254740991 "invalid WebRTC packets"))))
        (Decode.field "frames" (Decode.nullable (Decode.float |> Decode.andThen (boundedFloat 0 9007199254740991 "invalid WebRTC frames"))))
        (Decode.field "durationMs" (Decode.nullable (Decode.float |> Decode.andThen (boundedFloat 0 9007199254740991 "invalid WebRTC duration"))))


mediaExperimentDecoder : Decode.Decoder MediaExperimentView
mediaExperimentDecoder =
    Decode.map6 MediaExperimentView
        (Decode.field "phase" boundedText)
        (Decode.field "audioCodec" (Decode.nullable boundedText))
        (Decode.field "videoCodec" (Decode.nullable boundedText))
        (Decode.field "iceState" boundedText)
        (Decode.field "dtlsState" boundedText)
        (Decode.field "transportClass" boundedText)


decodeMediaControlView : Decode.Value -> Result Decode.Error MediaControlView
decodeMediaControlView value =
    let
        decoder =
            (Decode.map8
                (\sequence state previewRef screenRef experimentRef call reason muted ->
                    { sequence = sequence, state = state, previewRef = previewRef, screenRef = screenRef, experimentRef = experimentRef
                    , experiment = Nothing, call = call, reason = reason, muted = muted, deafened = False
                    , devices = emptyMediaDevices, soundcheck = Nothing, recording = emptyMediaRecording, telemetry = emptyMediaTelemetry
                    , caption = Nothing, webRtc = Nothing
                    }
                )
                (Decode.field "sequence" (Decode.int |> Decode.andThen (boundedInteger 0 2147483647 "invalid media sequence")))
                (Decode.field "state" (enumDecoder [ "idle", "preparing", "ready", "in-call", "degraded", "failed" ]))
                (Decode.field "previewRef" (Decode.nullable opaqueRefDecoder))
                (Decode.field "screenRef" (Decode.nullable opaqueRefDecoder))
                (Decode.field "experimentRef" (Decode.nullable opaqueRefDecoder))
                (Decode.field "call" (Decode.nullable (Decode.map2 (\conversationId callRef -> { conversationId = conversationId, callRef = callRef }) (Decode.field "conversationId" (Decode.string |> Decode.andThen (boundedTextLength 1 512 "invalid media conversation"))) (Decode.field "callRef" opaqueRefDecoder))))
                (Decode.field "reason" (Decode.nullable boundedText))
                (Decode.field "muted" Decode.bool)
            )
                |> Decode.andThen
                    (\partial ->
                        Decode.map2 (\deafened devices -> { partial | deafened = deafened, devices = devices })
                            (Decode.field "deafened" Decode.bool)
                            (Decode.field "devices" mediaDeviceViewDecoder)
                    )
                |> Decode.andThen
                    (\partial ->
                        Decode.map2 (\soundcheck recording -> { partial | soundcheck = soundcheck, recording = recording })
                            (Decode.field "soundcheck" (Decode.nullable mediaSoundcheckDecoder))
                            (Decode.field "recording" mediaRecordingDecoder)
                    )
                |> Decode.andThen
                    (\partial ->
                        Decode.map2 (\telemetry caption -> { partial | telemetry = telemetry, caption = caption })
                            (Decode.field "telemetry" mediaTelemetryDecoder)
                            (Decode.field "caption" (Decode.nullable mediaCaptionDecoder))
                    )
                |> Decode.andThen
                    (\partial ->
                        Decode.map2 (\webRtc experiment -> { partial | webRtc = webRtc, experiment = experiment })
                            (Decode.field "webRtc" (Decode.nullable mediaWebRtcDecoder))
                            (Decode.field "experiment" (Decode.nullable mediaExperimentDecoder))
                    )
    in
    Decode.decodeValue decoder value


emptyMediaDevices : MediaDeviceView
emptyMediaDevices =
    { inputs = [], outputs = [], selectedInputRef = Nothing, requestedInputRef = Nothing, appliedInputRef = Nothing
    , inputState = "idle", inputReason = Nothing, selectedOutputRef = Nothing, requestedOutputRef = Nothing
    , appliedOutputRef = Nothing, outputState = "idle", outputReason = Nothing, requestedVolumePercent = 0, appliedVolumePercent = Nothing
    }


emptyMediaRecording : MediaRecordingView
emptyMediaRecording =
    { ownConsent = "unknown", consentRequest = "idle", desiredAction = Nothing, requestState = "idle", actual = "unknown"
    , rosterState = "unknown", allConsented = Nothing, policyRevision = Nothing, reason = Nothing
    }


emptyMediaTelemetry : MediaTelemetryView
emptyMediaTelemetry =
    { sampledAtMonotonicMs = 0, counters = [], availability = "unavailable", reason = Nothing }


sessionLocalRowDecoder : Decode.Decoder SessionLocalRow
sessionLocalRowDecoder =
    Decode.map5 SessionLocalRow
        (Decode.field "rowRef" opaqueRefDecoder)
        (Decode.field "index" (Decode.int |> Decode.andThen (boundedInteger 1 4096 "local session index")))
        (Decode.field "signonMs" canonicalSigned64Decoder)
        (Decode.field "state" (enumDecoder [ "attached", "detached", "unknown" ]))
        (Decode.field "current" Decode.bool)


sessionMeshRowDecoder : Decode.Decoder SessionMeshRow
sessionMeshRowDecoder =
    Decode.map8 SessionMeshRow
        (Decode.field "rowRef" opaqueRefDecoder)
        (Decode.field "groupRef" opaqueRefDecoder)
        (Decode.field "attachmentId" (Decode.nullable (Decode.string |> Decode.andThen (fixedLowerHex 32 "invalid attachment id"))))
        (Decode.field "nodeHex" (Decode.string |> Decode.andThen (boundedLowerHex 1 16 "invalid node id")))
        (Decode.field "state" (enumDecoder [ "revoked", "unknown", "attached", "detached" ]))
        (Decode.field "inventory" (enumDecoder [ "complete", "legacy-incomplete" ]))
        (Decode.field "coverage" (enumDecoder [ "ready", "partial" ]))
        (Decode.field "observedAt" canonicalNonnegativeI64Decoder)


accountCommunityGroupRowDecoder : Decode.Decoder AccountCommunityGroupRow
accountCommunityGroupRowDecoder =
    Decode.map2 AccountCommunityGroupRow
        (Decode.field "nick" boundedNickDecoder)
        (Decode.field "primary" Decode.bool)


autojoinRowDecoder : Decode.Decoder String
autojoinRowDecoder =
    Decode.string
        |> Decode.andThen
            (\channel ->
                case Wire.checkedUtf8ByteLength channel of
                    Just bytes ->
                        if bytes > 0 && bytes <= 128 && not (String.any passkeyControl channel) then Decode.succeed channel else Decode.fail "invalid autojoin channel"

                    Nothing ->
                        Decode.fail "invalid autojoin channel"
            )


boundedNickDecoder : Decode.Decoder String
boundedNickDecoder =
    Decode.string
        |> Decode.andThen
            (\nick ->
                case Wire.checkedUtf8ByteLength nick of
                    Just bytes ->
                        if bytes > 0 && bytes <= 64 && not (String.any passkeyControl nick) && not (String.contains " " nick) then Decode.succeed nick else Decode.fail "invalid nick"

                    Nothing ->
                        Decode.fail "invalid nick"
            )


draftRecoveryItemDecoder : Decode.Decoder DraftRecoveryItem
draftRecoveryItemDecoder =
    Decode.map5 DraftRecoveryItem
        (Decode.field "draftRef" opaqueRefDecoder)
        (Decode.field "conversationId" (Decode.string |> Decode.andThen (boundedTextLength 1 512 "invalid conversation")))
        (Decode.field "revision" (Decode.float |> Decode.andThen (boundedWholeFloat 0 9007199254740991 "invalid draft revision")))
        (Decode.field "updatedAtMs" (Decode.float |> Decode.andThen (boundedWholeFloat 0 9007199254740991 "invalid draft update time")))
        (Decode.field "ciphertextBytes" (Decode.int |> Decode.andThen (boundedInteger 16 67584 "invalid encrypted draft size")))


draftRecoveredDecoder : Decode.Decoder DraftRecovered
draftRecoveredDecoder =
    Decode.map4 DraftRecovered
        (Decode.field "draftRef" opaqueRefDecoder)
        (Decode.field "conversationId" (Decode.string |> Decode.andThen (boundedTextLength 1 512 "invalid conversation")))
        (Decode.field "revision" (Decode.float |> Decode.andThen (boundedWholeFloat 0 9007199254740991 "invalid draft revision")))
        (Decode.field "text" draftRecoveredTextDecoder)


draftRecoveredTextDecoder : Decode.Decoder String
draftRecoveredTextDecoder =
    Decode.string
        |> Decode.andThen
            (\content ->
                case Wire.checkedUtf8ByteLength content of
                    Just bytes ->
                        if bytes <= 65536 && not (String.contains "\u{0000}" content) then Decode.succeed content else Decode.fail "invalid recovered draft text"

                    Nothing ->
                        Decode.fail "invalid recovered draft text"
            )


opaqueRefDecoder : Decode.Decoder String
opaqueRefDecoder =
    Decode.string
        |> Decode.andThen
            (\raw ->
                if String.length raw >= 22 && String.length raw <= 128 && String.all isOpaqueRefChar raw then
                    Decode.succeed raw

                else
                    Decode.fail "invalid opaque reference"
            )


isOpaqueRefChar : Char -> Bool
isOpaqueRefChar char =
    let
        code =
            Char.toCode char
    in
    (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || char == '_' || char == '-'


canonicalNonnegativeI64Decoder : Decode.Decoder String
canonicalNonnegativeI64Decoder =
    Decode.string
        |> Decode.andThen
            (\raw ->
                if canonicalDigits raw && (raw == "0" || not (String.startsWith "0" raw)) && decimalAtMost raw "9223372036854775807" then
                    Decode.succeed raw

                else
                    Decode.fail "invalid nonnegative timestamp"
            )


boundedInteger : Int -> Int -> String -> Int -> Decode.Decoder Int
boundedInteger minimum maximum label value =
    if value >= minimum && value <= maximum then Decode.succeed value else Decode.fail label


boundedWholeFloat : Float -> Float -> String -> Float -> Decode.Decoder Float
boundedWholeFloat minimum maximum label value =
    if value >= minimum && value <= maximum && toFloat (round value) == value then Decode.succeed value else Decode.fail label


boundedList : Int -> String -> List item -> Decode.Decoder (List item)
boundedList maximum label items =
    if List.length items <= maximum then Decode.succeed items else Decode.fail label


boundedTextLength : Int -> Int -> String -> String -> Decode.Decoder String
boundedTextLength minimum maximum label value =
    case Wire.checkedUtf8ByteLength value of
        Just bytes ->
            if bytes >= minimum && bytes <= maximum && not (String.any passkeyControl value) then Decode.succeed value else Decode.fail label

        Nothing ->
            Decode.fail label


boundedFloat : Float -> Float -> String -> Float -> Decode.Decoder Float
boundedFloat minimum maximum label value =
    if value /= value || value < minimum || value > maximum then
        Decode.fail label

    else
        Decode.succeed value


fixedLowerHex : Int -> String -> String -> Decode.Decoder String
fixedLowerHex expected label value =
    if String.length value == expected && String.all isLowerHex value then Decode.succeed value else Decode.fail label


boundedLowerHex : Int -> Int -> String -> String -> Decode.Decoder String
boundedLowerHex minimum maximum label value =
    if String.length value >= minimum && String.length value <= maximum && String.all isLowerHex value then Decode.succeed value else Decode.fail label


decodeWebAuthnView : Decode.Value -> Result Decode.Error WebAuthnView
decodeWebAuthnView value =
    Decode.decodeValue
        (Decode.map5 WebAuthnView
            (Decode.field "requestId" (runtimeIdDecoder Ids.requestIdFromRuntime Ids.requestIdToRuntime "request id"))
            (Decode.field "ceremonyRef" (Decode.nullable boundedText))
            (Decode.field "ceremony" (enumDecoder [ "register", "authenticate" ]))
            (Decode.field "phase" (enumDecoder [ "pending", "transport-admitted", "blocked", "unknown" ]))
            (Decode.field "reason" (Decode.nullable (enumDecoder [ "invalid-ceremony", "stale-owner", "unsupported", "cancelled", "rp-mismatch", "invalid-response", "transport-blocked", "transport-unknown" ])))
        )
        value


enumDecoder : List String -> Decode.Decoder String
enumDecoder allowed =
    Decode.string |> Decode.andThen (\value -> if List.member value allowed then Decode.succeed value else Decode.fail "invalid enum")


transferStampDecoder : Decode.Decoder SessionTransferStamp
transferStampDecoder =
    Decode.map3 SessionTransferStamp
        (Decode.field "ownerRef" boundedText)
        (Decode.field "accountGeneration" (Decode.int |> Decode.andThen (\value -> if value >= 0 then Decode.succeed value else Decode.fail "invalid account generation")))
        (Decode.field "connectionGeneration" (Decode.int |> Decode.andThen (\value -> if value >= 0 then Decode.succeed value else Decode.fail "invalid connection generation")))


passkeyRowDecoder : Decode.Decoder PasskeyRow
passkeyRowDecoder =
    Decode.map4 PasskeyRow
        (Decode.field "credentialRef" (runtimeIdDecoder Ids.credentialRefFromRuntime Ids.credentialRefToRuntime "credential ref"))
        (Decode.field "label" passkeyLabelDecoder)
        (Decode.field "signCount" canonicalUnsigned32Decoder)
        (Decode.field "createdUnix" canonicalSigned64Decoder)


passkeyLabelDecoder : Decode.Decoder String
passkeyLabelDecoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                case Wire.checkedUtf8ByteLength value of
                    Just bytes ->
                        if bytes <= 64 && not (String.any passkeyControl value) then Decode.succeed value else Decode.fail "invalid passkey label"

                    Nothing ->
                        Decode.fail "invalid passkey label"
            )


passkeyControl : Char -> Bool
passkeyControl char =
    let
        code =
            Char.toCode char
    in
    code < 32 || code == 127


redirectNodeChar : Char -> Bool
redirectNodeChar char =
    let
        code =
            Char.toCode char
    in
    (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || char == '.' || char == '_' || char == '-'


canonicalUnsigned32Decoder : Decode.Decoder String
canonicalUnsigned32Decoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                if canonicalDigits value && (value == "0" || not (String.startsWith "0" value)) && decimalAtMost value "4294967295" then
                    Decode.succeed value

                else
                    Decode.fail "invalid unsigned 32-bit decimal"
            )


canonicalSigned64Decoder : Decode.Decoder String
canonicalSigned64Decoder =
    Decode.string
        |> Decode.andThen
            (\value ->
                let
                    negative = String.startsWith "-" value
                    magnitude = if negative then String.dropLeft 1 value else value
                    bound = if negative then "9223372036854775808" else "9223372036854775807"
                in
                if canonicalDigits magnitude
                    && (magnitude == "0" && not negative || magnitude /= "0" && not (String.startsWith "0" magnitude))
                    && decimalAtMost magnitude bound then
                    Decode.succeed value

                else
                    Decode.fail "invalid signed 64-bit decimal"
            )


canonicalDigits : String -> Bool
canonicalDigits value =
    not (String.isEmpty value)
        && String.all
            (\char ->
                let
                    code =
                        Char.toCode char
                in
                code >= 48 && code <= 57
            )
            value


decimalAtMost : String -> String -> Bool
decimalAtMost value bound =
    String.length value < String.length bound
        || (String.length value == String.length bound && value <= bound)


runtimeIdDecoder : (String -> Maybe id) -> (id -> String) -> String -> Decode.Decoder String
runtimeIdDecoder parse print label =
    Decode.string
        |> Decode.andThen
            (\raw ->
                case parse raw of
                    Just value ->
                        Decode.succeed (print value)

                    Nothing ->
                        Decode.fail ("invalid " ++ label)
            )


readMarkerTimestampDecoder : Decode.Decoder String
readMarkerTimestampDecoder =
    Decode.string
        |> Decode.andThen
            (\raw ->
                case Ids.readMarkerTimestampFromWire raw of
                    Just timestamp -> Decode.succeed (Ids.readMarkerTimestampToWire timestamp)
                    Nothing -> Decode.fail "invalid read marker timestamp"
            )


validated constructor label raw =
    constructor raw |> Maybe.map Decode.succeed |> Maybe.withDefault (Decode.fail ("invalid " ++ label))


decodeSafeItems : String -> Decode.Value -> List SafeItem
decodeSafeItems domain value =
    let
        fieldName =
            case domain of
                "tab-intent" -> "intents"
                "account-security" -> "security"
                "continuation" -> "items"
                "workspace" -> "items"
                "journal" -> "entries"
                "scheduled" -> "items"
                "eviction" -> "plan"
                "group" -> "bootstrap"
                _ -> ""

        itemDecoder =
            case domain of
                "tab-intent" ->
                    Decode.map2 (\ref state -> { ref = ref, label = state, state = state, extra = [] })
                        (Decode.field "intentRef" boundedText)
                        (Decode.field "state" boundedText)

                "continuation" ->
                    Decode.map6
                        (\ref network account issuer remembered usable ->
                            { ref = ref
                            , label = account ++ " on " ++ network ++ " via " ++ issuer
                            , state = if usable then "usable" else "expired-or-unavailable"
                            , extra = [ if remembered then "remembered" else "memory-only" ]
                            }
                        )
                        (Decode.field "continuationRef" boundedText)
                        (Decode.field "networkId" boundedText)
                        (Decode.field "accountId" boundedText)
                        (Decode.field "issuerEndpointId" boundedText)
                        (Decode.field "remembered" Decode.bool)
                        (Decode.field "usable" Decode.bool)

                "workspace" ->
                    Decode.map6
                        (\ref network account remembered selected locked ->
                            { ref = ref
                            , label = network ++ (Maybe.map (\accountLabel -> " / " ++ accountLabel) account |> Maybe.withDefault "") ++ (if remembered then " · remembered" else "")
                            , state = if locked then "locked" else if selected then "selected" else "unlocked"
                            , extra = []
                            }
                        )
                        (Decode.field "workspaceRef" boundedText)
                        (Decode.field "networkId" boundedText)
                        (Decode.field "accountId" (Decode.nullable boundedText))
                        (Decode.field "remembered" Decode.bool)
                        (Decode.field "selected" Decode.bool)
                        (Decode.field "locked" Decode.bool)

                "journal" ->
                    Decode.map4 (\ref label state durability -> { ref = ref, label = label, state = state, extra = [ durability ] })
                        (Decode.field "entryRef" boundedText)
                        (Decode.field "intent" boundedText)
                        (Decode.field "state" boundedText)
                        (Decode.field "durability" (Decode.string |> Decode.andThen (\durability -> if List.member durability [ "durable", "volatile" ] then Decode.succeed durability else Decode.fail "invalid journal durability")))

                "scheduled" ->
                    Decode.map6
                        (\ref target due revision state mode ->
                            { ref = ref
                            , label = Maybe.withDefault "unknown target" target ++ (Maybe.map (\instant -> " · " ++ String.fromInt instant) due |> Maybe.withDefault "")
                            , state = state ++ (if mode == "volatile" then " · current connection only" else "")
                            , extra =
                                case revision of
                                    Just revisionValue ->
                                        [ String.fromInt revisionValue ]

                                    Nothing ->
                                        []
                            }
                        )
                        (Decode.field "scheduleRef" boundedText)
                        (Decode.field "conversationId" (Decode.nullable boundedText))
                        (Decode.field "dueAtMs" (Decode.nullable Decode.int))
                        (Decode.field "revision" (Decode.nullable (Decode.int |> Decode.andThen (\revision -> if revision > 0 then Decode.succeed revision else Decode.fail "invalid scheduled revision"))))
                        (Decode.field "state" boundedText)
                        (Decode.field "mode" (Decode.string |> Decode.andThen (\mode -> if List.member mode [ "durable", "volatile" ] then Decode.succeed mode else Decode.fail "invalid scheduled mode")))

                "eviction" ->
                    Decode.map3 (\ref selected retained -> { ref = ref, label = String.fromInt selected ++ " selected", state = "plan; retained " ++ String.fromInt retained, extra = [] })
                        (Decode.at [ "plan", "planRef" ] boundedText)
                        (Decode.at [ "plan", "selectedCount" ] Decode.int)
                        (Decode.at [ "plan", "retainedCount" ] Decode.int)

                "group" ->
                    Decode.map4 (\ref epoch signerDevice fingerprint -> { ref = ref, label = "epoch " ++ String.fromInt epoch ++ " signer " ++ signerDevice, state = "bootstrap-preview:" ++ fingerprint, extra = [] })
                        (Decode.at [ "bootstrap", "previewRef" ] boundedText)
                        (Decode.at [ "bootstrap", "epoch" ] Decode.int)
                        (Decode.at [ "bootstrap", "signerDeviceId" ] boundedText)
                        (Decode.at [ "bootstrap", "signerFingerprint" ] boundedText)

                "storage" ->
                    Decode.map3 (\ref label state -> { ref = ref, label = label, state = state, extra = [] })
                        (Decode.field "recordRef" boundedText)
                        (Decode.field "label" boundedText)
                        (Decode.field "state" boundedText)

                _ ->
                    Decode.fail "no public items"
    in
    if domain == "scheduled" then
        Decode.decodeValue (Decode.at [ "items" ] (Decode.list itemDecoder)) value
            |> Result.map (List.take 256)
            |> Result.withDefault []
    else if domain == "settings" then
        decodeSettingsItems value
    else if domain == "account-security" then
        decodeAccountSecurityItems value
    else if domain == "webauthn" then
        decodeWebAuthnItems value
    else if domain == "session" then
        decodeSessionItems value
    else if domain == "operator-import" then
        decodeOperatorItems value
    else if domain == "group" then
        decodeGroupItems value
    else if domain == "platform" then
        decodePlatformItems value
    else if domain == "media" then
        decodeMediaItems value
    else if domain == "storage" then
        decodeStorageItems value
    else if fieldName == "" then [] else
        Decode.decodeValue (Decode.at [ fieldName ] (Decode.list itemDecoder)) value
            |> Result.map (List.take 256)
            |> Result.withDefault []


decodeScheduledItems : Decode.Value -> List ScheduledItem
decodeScheduledItems value =
    Decode.decodeValue (Decode.field "items" (Decode.list scheduledItemDecoder)) value
        |> Result.map (List.take 256)
        |> Result.withDefault []


scheduledItemDecoder : Decode.Decoder ScheduledItem
scheduledItemDecoder =
    Decode.map8
        (\scheduleRef operationId conversationId dueAtMs messageKind replyTo audiencePrefix revision ->
            { scheduleRef = scheduleRef
            , operationId = operationId
            , conversationId = conversationId
            , dueAtMs = dueAtMs
            , messageKind = messageKind
            , replyTo = replyTo
            , audiencePrefix = audiencePrefix |> Maybe.map String.toList |> Maybe.andThen List.head
            , revision = revision
            , mode = "durable"
            , state = "scheduled"
            }
        )
        (Decode.field "scheduleRef" boundedText)
        (Decode.field "operationId" (Decode.nullable boundedText))
        (Decode.field "conversationId" (Decode.nullable boundedText))
        (Decode.field "dueAtMs" (Decode.nullable (Decode.int |> Decode.andThen (\n -> if n >= 0 then Decode.succeed n else Decode.fail "invalid due time"))))
        (Decode.field "messageKind" (Decode.nullable (Decode.string |> Decode.andThen (\kind -> if List.member kind [ "message", "action" ] then Decode.succeed kind else Decode.fail "invalid scheduled kind"))))
        (Decode.field "replyTo" (Decode.nullable boundedText))
        (Decode.field "audiencePrefix" (Decode.nullable (Decode.string |> Decode.andThen (\prefix -> if String.length prefix == 1 then Decode.succeed prefix else Decode.fail "invalid audience prefix"))))
        (Decode.field "revision" (Decode.nullable (Decode.int |> Decode.andThen (\n -> if n > 0 then Decode.succeed n else Decode.fail "invalid revision"))))
        |> Decode.andThen
            (\item ->
                Decode.map2
                    (\mode state -> { item | mode = mode, state = state })
                    (Decode.field "mode" (Decode.string |> Decode.andThen (\mode -> if List.member mode [ "durable", "volatile" ] then Decode.succeed mode else Decode.fail "invalid mode")))
                    (Decode.field "state" (Decode.string |> Decode.andThen (\state -> if List.member state [ "scheduled", "dispatching", "delivery-unknown", "legacy-review", "policy-review" ] then Decode.succeed state else Decode.fail "invalid state")))
            )
decodeSessionItems : Decode.Value -> List SafeItem
decodeSessionItems value =
    let
        credentialDecoder =
            Decode.map4
                (\ref kind issuer restorable ->
                    { ref = ref
                    , label = kind ++ " attachment from " ++ issuer
                    , state = if restorable then "restorable" else "unavailable"
                    , extra = []
                    }
                )
                (Decode.field "credentialRef" boundedText)
                (Decode.field "credentialKind" boundedText)
                (Decode.field "issuerEndpointId" boundedText)
                (Decode.field "restorable" Decode.bool)
    in
    Decode.decodeValue (Decode.at [ "credentials" ] (Decode.list credentialDecoder)) value
        |> Result.map (List.take 32)
        |> Result.withDefault []


decodeSettingsItems : Decode.Value -> List SafeItem
decodeSettingsItems value =
    let
        valueDecoder =
            Decode.map2 Tuple.pair
                (Decode.field "key" boundedText)
                (Decode.field "value" (Decode.oneOf [ Decode.string, Decode.bool |> Decode.map (\v -> if v then "on" else "off"), Decode.int |> Decode.map String.fromInt ]))

        decoder =
            Decode.map3
                (\ref values confirmations ->
                    { ref = ref
                    , label = "Settings preview"
                    , state = "settings-preview"
                    , extra = [ String.join ", " (List.map (\( key, val ) -> key ++ "=" ++ val) values), String.join "," confirmations ]
                    }
                )
                (Decode.field "previewRef" boundedText)
                (Decode.field "values" (Decode.list valueDecoder |> Decode.map (List.take 32)))
                (Decode.field "requiresOptInConfirmation" (Decode.list boundedText |> Decode.map (List.filter (\key -> List.member key [ "linkPreviews", "notificationPreviews" ]))))
    in
    Decode.decodeValue (Decode.at [ "preview" ] (Decode.nullable decoder)) value
        |> Result.toMaybe
        |> Maybe.withDefault Nothing
        |> Maybe.map List.singleton
        |> Maybe.withDefault []


decodeAccountSecurityItems : Decode.Value -> List SafeItem
decodeAccountSecurityItems value =
    let
        validatedState fieldName allowed =
            Decode.field fieldName
                (Decode.string
                    |> Decode.andThen
                        (\state ->
                            if List.member state allowed then
                                Decode.succeed state

                            else
                                Decode.fail "invalid account-security state"
                        )
                )

        decoder =
            Decode.map7
                (\action phase totpState remaining presentationRef reason version ->
                    { ref = Maybe.withDefault "" presentationRef
                    , label = action
                    , state = "security:" ++ phase
                    , extra = [ totpState, Maybe.withDefault "" (Maybe.map String.fromInt remaining), Maybe.withDefault "" reason ]
                    }
                )
                (validatedState "action" [ "totp-status", "totp-enroll", "totp-disable", "totp-confirm", "recovery-status", "recovery-generate", "recovery-clear", "recovery-login", "account-email", "account-password", "account-certificate-reset", "account-drop", "password-reset-request", "password-reset-confirm", "account-register", "account-verify", "present", "copy", "dismiss" ])
                (validatedState "phase" [ "pending", "accepted", "unknown", "blocked", "failed", "dismissed" ])
                (validatedState "totpState" [ "unknown", "disabled", "pending", "active" ])
                (Decode.field "remainingCodes" (Decode.nullable (Decode.int |> Decode.andThen (\count -> if count >= 0 && count <= 256 then Decode.succeed count else Decode.fail "invalid recovery count"))))
                (Decode.field "presentationRef" (Decode.nullable boundedText))
                (Decode.field "reason" (Decode.nullable safeReasonDecoder))
                (Decode.field "schemaVersion" (Decode.int |> Decode.andThen (\schema -> if schema == 1 then Decode.succeed schema else Decode.fail "invalid account-security schema")))
    in
    Decode.decodeValue decoder value
        |> Result.map List.singleton
        |> Result.withDefault []


decodeWebAuthnItems : Decode.Value -> List SafeItem
decodeWebAuthnItems value =
    let
        decoder =
            Decode.map5
                (\requestId ceremonyRef ceremony phase reason ->
                    { ref = Maybe.withDefault "" ceremonyRef
                    , label = "Passkey " ++ ceremony ++ " request " ++ requestId
                    , state = "webauthn:" ++ phase
                    , extra = [ Maybe.withDefault "" reason ]
                    }
                )
                (Decode.field "requestId" boundedText)
                (Decode.field "ceremonyRef" (Decode.nullable boundedText))
                (Decode.field "ceremony" (Decode.string |> Decode.andThen (only [ "register", "authenticate" ])))
                (Decode.field "phase" (Decode.string |> Decode.andThen (only [ "pending", "transport-admitted", "blocked", "unknown" ])))
                (Decode.field "reason" (Decode.nullable (Decode.string |> Decode.andThen (only [ "invalid-ceremony", "stale-owner", "unsupported", "cancelled", "rp-mismatch", "invalid-response", "transport-blocked", "transport-unknown" ]))))
    in
    Decode.decodeValue decoder value |> Result.map List.singleton |> Result.withDefault []


decodeGroupItems : Decode.Value -> List SafeItem
decodeGroupItems value =
    let
        bootstrapDecoder =
            Decode.map4
                (\ref epoch signerDevice fingerprint -> { ref = ref, label = "epoch " ++ String.fromInt epoch ++ " signer " ++ signerDevice, state = "bootstrap-preview:" ++ fingerprint, extra = [] })
                (Decode.field "previewRef" boundedText)
                (Decode.field "epoch" Decode.int)
                (Decode.field "signerDeviceId" boundedText)
                (Decode.field "signerFingerprint" boundedText)

        backupBaseDecoder =
            Decode.map8
                (\ref network account conversation epoch commitHash signerAccount signerDevice ->
                    { ref = ref, network = network, account = account, conversation = conversation, epoch = epoch, commitHash = commitHash, signerAccount = signerAccount, signerDevice = signerDevice }
                )
                (Decode.field "previewRef" boundedText)
                (Decode.field "networkId" boundedText)
                (Decode.field "accountId" boundedText)
                (Decode.field "conversationId" boundedText)
                (Decode.field "epoch" Decode.int)
                (Decode.field "commitHashHex" (Decode.string |> Decode.andThen (hex64Decoder "invalid backup commit hash")))
                (Decode.field "signerAccountId" boundedText)
                (Decode.field "signerDeviceId" boundedText)

        backupCoreDecoder =
            Decode.map3
                (\base fingerprint trust ->
                    { ref = base.ref
                    , label = "Encrypted history checkpoint, epoch " ++ String.fromInt base.epoch ++ ", signer " ++ base.signerAccount ++ "/" ++ base.signerDevice
                    , state = "portable-backup-preview:" ++ fingerprint
                    , extra = [ base.network, base.account, base.conversation, base.commitHash, trust ]
                    }
                )
                backupBaseDecoder
                (Decode.field "signerFingerprintHex" (Decode.string |> Decode.andThen (hex64Decoder "invalid signer fingerprint")))
                (Decode.field "trust" (Decode.string |> Decode.andThen (only [ "matches-local-receipt", "new-history-checkpoint" ])))

        backupDecoder =
            Decode.map2 Tuple.pair backupCoreDecoder (Decode.field "historyOnly" Decode.bool)
                |> Decode.andThen
                    (\( item, historyOnly ) ->
                        if historyOnly then Decode.succeed item else Decode.fail "backup is not history-only"
                    )

        planDecoder =
            Decode.map3
                (\ref revision nextEpoch -> { ref = ref, label = "Room key update to epoch " ++ String.fromInt nextEpoch, state = "author-plan", extra = [ revision ] })
                (Decode.field "planRef" boundedText)
                (Decode.field "membershipRevision" boundedText)
                (Decode.field "nextEpoch" Decode.int)

        headDecoder =
            Decode.map3
                (\conversation epoch hash ->
                    case ( conversation, epoch, hash ) of
                        ( Just room, Just currentEpoch, Just currentHash ) ->
                            if String.length currentHash == 64 && String.all isLowerHex currentHash then
                                Just { ref = room, label = "Verified room head at epoch " ++ String.fromInt currentEpoch, state = "author-ready", extra = [ String.fromInt currentEpoch, currentHash ] }
                            else
                                Nothing

                        _ ->
                            Nothing
                )
                (Decode.field "conversationId" (Decode.nullable boundedText))
                (Decode.field "epoch" (Decode.nullable Decode.int))
                (Decode.field "currentCommitHashHex" (Decode.nullable boundedText))

        bootstrap = Decode.decodeValue (Decode.at [ "bootstrap" ] (Decode.nullable bootstrapDecoder)) value |> Result.withDefault Nothing
        backup = Decode.decodeValue (Decode.at [ "backupPreview" ] (Decode.nullable backupDecoder)) value |> Result.withDefault Nothing
        plan = Decode.decodeValue (Decode.at [ "plan" ] (Decode.nullable planDecoder)) value |> Result.withDefault Nothing
        head = Decode.decodeValue headDecoder value |> Result.withDefault Nothing
        deviceDecoder room currentEpoch currentHash =
            Decode.map3
                (\account device trust ->
                    { ref = room
                    , label = "Device " ++ device ++ " on account " ++ account
                    , state = "group-device"
                    , extra = [ account, device, trust, String.fromInt currentEpoch, currentHash ]
                    }
                )
                (Decode.field "accountId" boundedText)
                (Decode.field "deviceId" boundedText)
                (Decode.field "trusted" (Decode.string |> Decode.andThen (only [ "trusted", "untrusted", "unknown" ])))

        {- Removal must name the verified head, so a directory without one
           lists no removable devices. -}
        devices =
            case head of
                Just verified ->
                    case verified.extra of
                        epochText :: currentHash :: _ ->
                            case String.toInt epochText of
                                Just currentEpoch ->
                                    Decode.decodeValue (Decode.field "devices" (Decode.list (deviceDecoder verified.ref currentEpoch currentHash))) value
                                        |> Result.withDefault []

                                Nothing ->
                                    []

                        _ ->
                            []

                Nothing ->
                    []

        {- Explicit device trust review: the fingerprint is the SHA-256 of the
           member device's signer key from the authenticated directory.
        -}
        deviceTrust =
            Decode.decodeValue
                (Decode.maybe
                    (Decode.field "deviceTrust"
                        (Decode.map4
                            (\ref account device fingerprint ->
                                { ref = ref, label = "Device " ++ device ++ " on account " ++ account, state = "device-trust-preview:" ++ fingerprint, extra = [ account, device ] }
                            )
                            (Decode.field "previewRef" (Decode.string |> Decode.andThen (\candidate -> if String.length candidate == 48 && String.all isLowerHex candidate then Decode.succeed candidate else Decode.fail "invalid preview ref")))
                            (Decode.field "accountId" boundedText)
                            (Decode.field "deviceId" boundedText)
                            (Decode.field "fingerprintHex" (Decode.string |> Decode.andThen (hex64Decoder "invalid device fingerprint")))
                        )
                    )
                )
                value
                |> Result.withDefault Nothing

        operation =
            Decode.decodeValue
                (Decode.map2
                    (\ref phase -> Maybe.map (\operationRef -> { ref = operationRef, label = "Room operation", state = "operation:" ++ phase, extra = [] }) ref)
                    (Decode.field "operationRef" (Decode.nullable boundedText))
                    (Decode.field "phase" boundedText)
                )
                value
                |> Result.withDefault Nothing
    in
    List.filterMap identity [ backup, bootstrap, head, plan, operation, deviceTrust ] ++ devices


hex64Decoder : String -> String -> Decode.Decoder String
hex64Decoder message candidate =
    if String.length candidate == 64 && String.all isLowerHex candidate then Decode.succeed candidate else Decode.fail message


isLowerHex : Char -> Bool
isLowerHex char =
    (char >= '0' && char <= '9') || (char >= 'a' && char <= 'f')


decodeOperatorItems : Decode.Value -> List SafeItem
decodeOperatorItems value =
    let
        doctor =
            Decode.decodeValue
                (Decode.map5
                    (\ref build passed failed manager ->
                        { ref = ref, label = "Onyx Server doctor report", state = "operator-doctor"
                        , extra = [ Maybe.withDefault "unknown" build, String.fromInt passed, String.fromInt failed, manager
                                  , safeProjectedList [ "plan", "checks" ] doctorCheckLine value
                                  , safeProjectedList [ "plan", "capabilities" ] capabilityLine value
                                  , diagnosticSummary value
                                  , observationsSummary value
                                  , serviceArgumentsSummary value
                                  ]
                        }
                    )
                    (Decode.field "previewRef" boundedText)
                    (Decode.at [ "plan", "exporterBuild" ] (Decode.nullable boundedText))
                    (Decode.at [ "plan", "diagnostics", "passed" ] Decode.int)
                    (Decode.at [ "plan", "diagnostics", "failed" ] Decode.int)
                    (Decode.at [ "plan", "service", "manager" ] safeServiceManager)
                )
                value
        setup =
            Decode.decodeValue
                (Decode.map8
                    (\ref mode profile validation mediaEnabled maxClients tlsPort manager ->
                        { ref = ref
                        , label = "Onyx Server setup preview"
                        , state = "operator-setup"
                        , extra = [ mode, Maybe.withDefault "unknown" profile, validation, mediaEnabled, Maybe.map String.fromInt maxClients |> Maybe.withDefault "unknown", Maybe.map String.fromInt tlsPort |> Maybe.withDefault "unknown", manager
                                  , setupNetworkSummary value
                                  , setupMediaSummary value
                                  , serviceArgumentsSummary value
                                  , Maybe.withDefault "unknown" (Decode.decodeValue (Decode.at [ "plan", "readiness" ] (Decode.string |> Decode.andThen (only [ "unknown" ]))) value |> Result.toMaybe)
                                  ]
                        }
                    )
                    (Decode.field "previewRef" boundedText)
                    (Decode.at [ "plan", "mode" ] safeSetupMode)
                    (Decode.at [ "plan", "profile" ] (Decode.nullable safeProfile))
                    (Decode.at [ "plan", "network" ] (Decode.nullable (Decode.field "validation" safeNetworkValidation)) |> Decode.map (Maybe.withDefault "unknown"))
                    (Decode.at [ "plan", "media" ] (Decode.nullable (Decode.field "enabled" safeMediaEnabled)) |> Decode.map (Maybe.withDefault "unknown"))
                    (Decode.at [ "plan", "effectiveProfile" ] (Decode.nullable (Decode.field "maxClients" Decode.int)))
                    (Decode.at [ "plan", "network" ] (Decode.nullable (Decode.field "tlsPort" Decode.int)))
                    (Decode.at [ "plan", "service", "manager" ] safeServiceManager)
                )
                value
    in
    case doctor of
        Ok item -> [ item ]
        Err _ -> Result.toMaybe setup |> Maybe.map List.singleton |> Maybe.withDefault []


safeProjectedList : List String -> Decode.Decoder String -> Decode.Value -> String
safeProjectedList path decoder value =
    Decode.decodeValue (Decode.at path (Decode.list decoder)) value
        |> Result.map (List.take 32 >> String.join ", ")
        |> Result.withDefault "unknown"


doctorCheckLine : Decode.Decoder String
doctorCheckLine =
    Decode.map2 Tuple.pair
        (Decode.field "id" (Decode.string |> Decode.andThen (only [ "sqpoll_defer_taskrun", "ktls_txrx", "mesh_security", "mesh_cloak", "cloak_anon_cadence", "ocsp_leaf_uri", "mesh_capabilities", "mesh_transport_security", "s2s_handshake", "unknown-check" ])))
        (Decode.field "status" (Decode.string |> Decode.andThen (only [ "pass", "fail", "skipped", "unknown" ])))
        |> Decode.map (\( ident, status ) -> ident ++ ":" ++ status)


capabilityLine : Decode.Decoder String
capabilityLine =
    Decode.map2 Tuple.pair
        (Decode.field "name" (Decode.string |> Decode.andThen (only [ "mesh_peers_configured", "mesh_require_secured", "mesh_require_signed_frames", "mesh_cloak_configured", "cloak_account", "cloak_anon_rotation", "tls_configured", "ocsp_configured", "unknown-capability" ])))
        (Decode.field "configured" Decode.bool)
        |> Decode.map (\( name, configured ) -> name ++ ":" ++ (if configured then "configured" else "not-configured"))


diagnosticSummary : Decode.Value -> String
diagnosticSummary value =
    Decode.decodeValue
        (Decode.map5 (\total passed failed skipped truncated -> "diagnostics " ++ String.fromInt total ++ " total, " ++ String.fromInt passed ++ " passed, " ++ String.fromInt failed ++ " failed, " ++ String.fromInt skipped ++ " skipped; truncated=" ++ (if truncated then "yes" else "no"))
            (Decode.at [ "plan", "diagnostics", "total" ] Decode.int)
            (Decode.at [ "plan", "diagnostics", "passed" ] Decode.int)
            (Decode.at [ "plan", "diagnostics", "failed" ] Decode.int)
            (Decode.at [ "plan", "diagnostics", "skipped" ] Decode.int)
            (Decode.at [ "plan", "diagnostics", "truncated" ] Decode.bool))
        value |> Result.withDefault "diagnostics unknown"


observationsSummary : Decode.Value -> String
observationsSummary value =
    let
        metric name =
            Decode.decodeValue (Decode.at [ "plan", "observations", name ] (Decode.nullable Decode.int)) value
                |> Result.toMaybe
                |> Maybe.withDefault Nothing
        display name = Maybe.map String.fromInt (metric name) |> Maybe.withDefault "unknown"
    in
    "observations: TCP " ++ display "tcpActive" ++ ", links " ++ display "establishedLinks" ++ ", peers " ++ display "peersUp" ++ "/" ++ display "peersTotal" ++ ", quorum " ++ display "quorum" ++ ", components " ++ display "components" ++ ", partitioned " ++ display "partitioned"


setupNetworkSummary : Decode.Value -> String
setupNetworkSummary value =
    Decode.decodeValue
        (Decode.map6 (\irc tls tlsEnabled validation hostname address -> "network IRC/TLS ports " ++ String.fromInt irc ++ "/" ++ String.fromInt tls ++ ", TLS=" ++ boolWord tlsEnabled ++ ", validation=" ++ validation ++ ", hostname=" ++ hostname ++ ", address=" ++ address)
            (Decode.at [ "plan", "network", "ircPort" ] Decode.int)
            (Decode.at [ "plan", "network", "tlsPort" ] Decode.int)
            (Decode.at [ "plan", "network", "tlsEnabled" ] Decode.bool)
            (Decode.at [ "plan", "network", "validation" ] (Decode.string |> Decode.andThen (only [ "static-passed", "pending", "unknown" ])))
            (Decode.at [ "plan", "network", "hostnameSyntax" ] (Decode.string |> Decode.andThen (only [ "valid", "invalid", "unknown" ])))
            (Decode.at [ "plan", "network", "addressSyntax" ] (Decode.string |> Decode.andThen (only [ "ipv4", "ipv6", "unknown" ]))))
        value |> Result.withDefault "network assessment unknown"


setupMediaSummary : Decode.Value -> String
setupMediaSummary value =
    Decode.decodeValue
        (Decode.map5 (\enabled readiness relay configured existing -> "media=" ++ enabled ++ ", readiness=" ++ readiness ++ ", relay=" ++ relay ++ ", configured=" ++ (if configured then "yes" else "no") ++ ", existing=" ++ (if existing then "yes" else "no"))
            (Decode.at [ "plan", "media", "enabled" ] (Decode.string |> Decode.andThen (only [ "yes", "no", "unknown" ])))
            (Decode.at [ "plan", "media", "readiness" ] (Decode.string |> Decode.andThen (only [ "unknown" ])))
            (Decode.at [ "plan", "media", "relay" ] (Decode.string |> Decode.andThen (only [ "unknown" ])))
            (Decode.at [ "plan", "media", "configured" ] (Decode.nullable Decode.value) |> Decode.map ((/=) Nothing))
            (Decode.oneOf [ Decode.at [ "plan", "media", "configured", "existing" ] Decode.bool, Decode.succeed False ]))
        value |> Result.withDefault "media assessment unknown"


serviceArgumentsSummary : Decode.Value -> String
serviceArgumentsSummary value =
    Decode.decodeValue (Decode.at [ "plan", "service", "argumentsBounded" ] Decode.bool) value
        |> Result.map (\bounded -> "service arguments " ++ (if bounded then "bounded" else "unknown"))
        |> Result.withDefault "service arguments unknown"


boolWord : Bool -> String
boolWord enabled =
    if enabled then "enabled" else "disabled"


only : List String -> String -> Decode.Decoder String
only accepted candidate =
    if List.member candidate accepted then Decode.succeed candidate else Decode.fail "unsupported safe value"


safeServiceManager : Decode.Decoder String
safeServiceManager =
    Decode.string |> Decode.andThen (\value -> if List.member value [ "openrc", "systemd", "foreground", "unknown" ] then Decode.succeed value else Decode.fail "unknown service manager")


safeSetupMode : Decode.Decoder String
safeSetupMode =
    Decode.string |> Decode.andThen (\value -> if List.member value [ "preview", "review", "unsupported-mode" ] then Decode.succeed value else Decode.fail "unknown setup mode")


safeProfile : Decode.Decoder String
safeProfile =
    Decode.string |> Decode.andThen (\value -> if List.member value [ "existing", "private", "community", "media" ] then Decode.succeed value else Decode.fail "unknown setup profile")


safeNetworkValidation : Decode.Decoder String
safeNetworkValidation =
    Decode.string |> Decode.andThen (\value -> if List.member value [ "static-passed", "pending", "unknown" ] then Decode.succeed value else Decode.fail "unknown network validation")


safeMediaEnabled : Decode.Decoder String
safeMediaEnabled =
    Decode.string |> Decode.andThen (\value -> if List.member value [ "yes", "no", "unknown" ] then Decode.succeed value else Decode.fail "unknown media state")


decodePlatformItems : Decode.Value -> List SafeItem
decodePlatformItems value =
    let
        worker =
            case Decode.decodeValue (Decode.at [ "worker", "status" ] boundedText) value of
                Ok state ->
                    let
                        target = Decode.decodeValue (Decode.at [ "worker", "targetRef" ] (Decode.nullable boundedText)) value |> Result.withDefault Nothing
                    in
                    [ { ref = Maybe.withDefault "" target, label = "Update worker", state = "worker:" ++ state, extra = [] } ]
                Err _ -> []
        push =
            case Decode.decodeValue (Decode.at [ "push", "serverRegistration" ] boundedText) value of
                Ok state ->
                    let consent = Decode.decodeValue (Decode.at [ "push", "consentRef" ] (Decode.nullable boundedText)) value |> Result.withDefault Nothing
                    in [ { ref = Maybe.withDefault "" consent, label = "Notifications", state = "push:" ++ state, extra = [] } ]
                Err _ -> []
    in
    worker ++ push


decodeMediaItems : Decode.Value -> List SafeItem
decodeMediaItems value =
    let
        preview =
            Decode.decodeValue (Decode.map2 Tuple.pair
                (Decode.field "previewRef" (Decode.nullable boundedText))
                (Decode.field "conversationId" (Decode.nullable boundedText))) value
                |> Result.toMaybe
                |> Maybe.withDefault ( Nothing, Nothing )
                |> (\( ref, conversation ) ->
                        case ( ref, conversation ) of
                            ( Just safeRef, Just target ) -> Just { ref = safeRef, label = "Camera preview", state = "camera-preview", extra = [ target ] }
                            _ -> Nothing
                   )

        experiment =
            Decode.decodeValue
                (Decode.map2 Tuple.pair
                    (Decode.field "experimentRef" (Decode.nullable boundedText))
                    (Decode.at [ "experiment", "phase" ] (Decode.nullable boundedText))
                )
                value
                |> Result.toMaybe
                |> Maybe.withDefault ( Nothing, Nothing )
                |> (\( ref, phase ) ->
                        case ( ref, phase ) of
                            ( Just safeRef, Just safePhase ) ->
                                Just { ref = safeRef, label = "Local WebRTC experiment", state = "webrtc:" ++ safePhase, extra = [] }

                            _ ->
                                Nothing
                   )

        screen =
            Decode.decodeValue (Decode.map2 Tuple.pair
                (Decode.field "screenRef" (Decode.nullable boundedText))
                (Decode.field "conversationId" (Decode.nullable boundedText))) value
                |> Result.toMaybe
                |> Maybe.withDefault ( Nothing, Nothing )
                |> (\( ref, conversation ) ->
                        case ( ref, conversation ) of
                            ( Just safeRef, Just target ) -> Just { ref = safeRef, label = "Screen share", state = "screen-share", extra = [ target ] }
                            _ -> Nothing
                   )
    in
    List.filterMap identity [ preview, experiment, screen ]


decodeStorageItems : Decode.Value -> List SafeItem
decodeStorageItems value =
    let
        itemDecoder =
            Decode.map3 (\ref label state -> { ref = ref, label = label, state = state, extra = [] })
                (Decode.field "recordRef" boundedText)
                (Decode.field "label" boundedText)
                (Decode.field "state" boundedText)

        planDecoder =
            Decode.map3 (\ref selected retained -> { ref = ref, label = "Selected local records", state = "export-plan", extra = [ String.fromInt selected, String.fromInt retained ] })
                (Decode.field "planRef" boundedText)
                (Decode.field "selectedCount" Decode.int)
                (Decode.field "retainedCount" Decode.int)

        rows =
            Decode.decodeValue (Decode.field "items" (Decode.list itemDecoder)) value
                |> Result.withDefault []
                |> List.take 256

        exportPlan =
            Decode.decodeValue (Decode.field "plan" (Decode.nullable planDecoder)) value
                |> Result.withDefault Nothing
                |> Maybe.map List.singleton
                |> Maybe.withDefault []
    in
    rows ++ exportPlan


boundedText : Decode.Decoder String
boundedText =
    Decode.string |> Decode.andThen (\value -> if String.length value <= 128 && not (String.contains "\u{0000}" value) then Decode.succeed value else Decode.fail "invalid safe label")


boundedDraftText : Decode.Decoder String
boundedDraftText =
    Decode.string |> Decode.andThen (\value -> if String.length value <= 65536 && not (String.contains "\u{0000}" value) then Decode.succeed value else Decode.fail "invalid draft text")


statusDecoder raw =
    case raw of
        "pending" -> Decode.succeed Pending
        "held" -> Decode.succeed Held
        "transport-admitted" -> Decode.succeed TransportAdmitted
        "accepted" -> Decode.succeed Accepted
        "unknown" -> Decode.succeed Unknown
        "blocked" -> Decode.succeed Blocked
        "failed" -> Decode.succeed Failed
        "cancelled" -> Decode.succeed Cancelled
        _ -> Decode.fail "invalid status"


scopeDecoder raw =
    if List.member raw [ "local", "transport", "server" ] then Decode.succeed raw else Decode.fail "invalid completion scope"


safeReasonDecoder : Decode.Decoder String
safeReasonDecoder =
    Decode.string
        |> Decode.andThen
            (\reason ->
                if List.member reason
                    [ "unsupported", "permission-denied", "permission-required", "storage-unavailable", "quota-exceeded", "invalid-response"
                    , "stale-owner", "timeout", "network-failed", "internal-failure", "service-unavailable", "owner-changed"
                    , "policy-unknown", "encryption-required", "missing-wire-body", "invalid-envelope", "operation-pending"
                    , "server-rejected", "version-mismatch", "request-id-conflict", "request-capacity", "attachment-intent-required"
                    , "attachment-lease-lost", "credential-unavailable", "remember-unavailable", "workspace-unavailable"
                    , "workspace-not-eligible", "file-ref-unavailable", "preview-unavailable", "notification-route-unavailable"
                    , "activation-target-unavailable", "activation-unavailable", "platform-unavailable", "consent-unavailable"
                    , "service-not-composed", "owner-retired", "api-unavailable", "registration-failed", "client-not-ready"
                    , "activation-failed", "unknown-clients", "permission-denied", "device-missing", "identity-unavailable"
                    , "transport-unavailable", "codec-unavailable", "untrusted-peer", "failed", "intent-busy", "unavailable"
                    , "expired", "device-unavailable", "membership-unverified", "wrong-owner", "wrong-room", "wrong-epoch"
                    , "backup-invalid", "backup-password", "install-rejected", "transport-blocked", "transport-unknown"
                    , "operation-unavailable", "offline", "subscription-failed", "binding-failed", "timeout-unknown", "node-changed"
                    , "busy", "invalid-input", "malformed-response", "not-proven", "copy-failed", "server-failure"
                    , "guest", "directory-incomplete", "membership-changed", "invalid-chain", "capacity-exceeded", "backup-required"
                    , "signing-unavailable", "send-blocked", "send-unknown", "commit-conflict", "cancelled", "capture-failed"
                    , "language-unavailable", "language-not-prepared", "explicit-consent-required", "call-not-active"
                    , "membership-unknown", "consent-revoked", "recognition-failed", "backpressure", "invalid-intent"
                    , "transport-error", "not-joined", "policy-changed", "reseal-required", "unsafe-policy", "invalid-payload"
                    , "local-key-unavailable", "not-started", "no-samples", "not-instrumented", "sampling-failed"
                    , "invalid-command", "unsupported-action", "invalid", "quota-failed", "memory-only-unsaved"
                    -- Bounded group-domain refusals emitted by the private runtime.
                    , "group-plan-unavailable", "plan-unavailable", "invalid-commit-hash", "membership-incomplete", "group-action-unavailable"
                    , "bootstrap-preview-unavailable", "bootstrap-approval-failed", "backup-private-ref-unavailable", "backup-password-unavailable"
                    , "backup-preview-unavailable", "invalid-backup-preview", "private-output-unavailable", "wrong-network"
                    , "accepted-epoch-unavailable", "epoch-material-unavailable", "evidence-unavailable", "explicit-trust-required"
                    , "checkpoint-conflict", "invalid-container", "workspace-locked", "wrong-account", "wrong-password-or-corrupt", "device-trust-unavailable"
                    ] then
                    Decode.succeed reason
                else
                    Decode.fail "invalid reason"
            )


domainDecoder : String -> Decode.Decoder String
domainDecoder domain =
    if List.member domain [ "session", "account-security", "account-community", "service-integration", "continuation", "webauthn", "workspace", "draft", "journal", "scheduled", "anchor", "settings", "storage", "eviction", "group", "platform", "tab-intent", "operator-import", "media", "integration" ] then Decode.succeed domain else Decode.fail "invalid domain"


actionDecoder : String -> Decode.Decoder String
actionDecoder action =
    if List.member action [ "new-attachment", "resume", "retry", "forget", "remember", "local-list", "local-drop", "mesh-list", "mesh-next", "mesh-revoke", "mesh-reconcile", "mesh-dismiss", "passkey-list", "passkey-rename", "passkey-remove", "autojoin-list", "autojoin-add", "autojoin-remove", "group-list", "group-add", "group-remove", "group-primary", "refresh", "botgrant-list", "botgrant-add", "botgrant-remove", "botcmd-list", "botcmd-add", "botcmd-run", "defer-at", "defer-cron", "defer-oper-at", "defer-oper-cron", "outhook-input", "outhook-add", "outhook-list", "outhook-inspect", "outhook-remove", "unfurl-off", "unfurl-on", "unfurl-preview", "memo-send", "memo-list", "memo-clear", "memo-forward", "memo-ignore-list", "memo-ignore-add", "memo-ignore-remove", "begin", "present", "select", "use", "create", "lock", "load", "save", "discard", "recover", "recovery-list", "queue", "list", "flush", "cancel", "reconcile", "dispatch", "edit", "viewed", "preview", "apply", "export", "clear", "directory-refresh", "trust-preview", "trust-confirm", "author-plan", "author-commit", "enroll", "welcome-request", "remove-device", "backup-export", "backup-import", "backup-approve", "backup-cancel", "bootstrap-preview", "bootstrap-approve", "bootstrap-cancel", "worker-register", "worker-activate", "worker-cancel", "push-inspect", "push-enable", "push-disable", "push-reconcile", "notification-route", "fresh", "restore", "retire", "get", "dismiss", "inspect", "roster-refresh", "devices-refresh", "soundcheck", "join", "leave", "input", "output", "mute", "deafen", "camera-preview", "preview-attach", "preview-retire", "camera-publish", "screen-start", "screen-stop", "consent", "record", "audio-recover", "caption-prepare", "caption-start", "caption-stop", "webrtc-run", "webrtc-stop", "fingerprint-compare", "quality", "webtransport-connect", "webtransport-fallback", "reconnect-media" ] then Decode.succeed action else Decode.fail "invalid action"


validPair : String -> String -> Bool
validPair domain action =
    case domain of
        "session" -> List.member action [ "new-attachment", "resume", "retry", "forget", "remember", "local-list", "local-drop", "mesh-list", "mesh-next", "mesh-revoke", "mesh-reconcile", "mesh-dismiss" ]
        "account-security" -> List.member action [ "begin", "present", "passkey-list", "passkey-rename", "passkey-remove" ]
        "account-community" -> List.member action [ "autojoin-list", "autojoin-add", "autojoin-remove", "group-list", "group-add", "group-remove", "group-primary" ]
        "service-integration" -> List.member action [ "refresh", "botgrant-list", "botgrant-add", "botgrant-remove", "botcmd-list", "botcmd-add", "botcmd-run", "defer-at", "defer-cron", "defer-oper-at", "defer-oper-cron", "outhook-input", "outhook-add", "outhook-list", "outhook-inspect", "outhook-remove", "unfurl-off", "unfurl-on", "unfurl-preview", "memo-send", "memo-list", "memo-clear", "memo-forward", "memo-ignore-list", "memo-ignore-add", "memo-ignore-remove" ]
        "webauthn" -> List.member action [ "begin", "cancel" ]
        "continuation" -> List.member action [ "list", "remember", "forget", "select", "use" ]
        "workspace" -> List.member action [ "list", "select", "lock", "remember" ]
        "draft" -> List.member action [ "load", "save", "discard", "recover", "recovery-list" ]
        "journal" -> List.member action [ "queue", "list", "flush", "retry", "cancel", "reconcile" ]
        "scheduled" -> List.member action [ "create", "edit", "list", "cancel", "dispatch", "reconcile" ]
        "anchor" -> List.member action [ "viewed", "load" ]
        "settings" -> List.member action [ "preview", "apply", "export" ]
        "storage" -> List.member action [ "export", "clear" ]
        "eviction" -> List.member action [ "preview", "apply" ]
        "group" -> List.member action [ "directory-refresh", "trust-preview", "trust-confirm", "author-plan", "author-commit", "enroll", "welcome-request", "remove-device", "backup-export", "backup-import", "backup-approve", "backup-cancel", "cancel", "bootstrap-preview", "bootstrap-approve", "bootstrap-cancel" ]
        "platform" -> List.member action [ "worker-register", "worker-activate", "worker-cancel", "push-inspect", "push-enable", "push-disable", "push-reconcile", "notification-route" ]
        "tab-intent" -> List.member action [ "fresh", "list", "restore", "retire" ]
        "operator-import" -> List.member action [ "preview", "get", "dismiss" ]
        "media" -> List.member action [ "inspect", "roster-refresh", "devices-refresh", "soundcheck", "join", "leave", "input", "output", "mute", "deafen", "camera-preview", "preview-attach", "preview-retire", "camera-publish", "screen-start", "screen-stop", "consent", "record", "audio-recover", "caption-prepare", "caption-start", "caption-stop", "webrtc-run", "webrtc-stop", "fingerprint-compare", "quality" ]
        "integration" -> List.member action [ "webtransport-connect", "webtransport-fallback", "reconnect-media" ]
        _ -> False
