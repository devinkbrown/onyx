module WorkerLifecycle exposing (ActivationState, Effect(..), Model, Msg(..), Status(..), init, retire, update)

{-| Pure public update-availability state. Browser worker references and cache
details stay on the JavaScript side; this module contains no private material.
-}

import Set exposing (Set)


type Status
    = Unsupported
    | Unregistered
    | Installing
    | Waiting
    | BlockedByClients Int
    | Activating
    | Ready
    | Failed String


type alias ActivationState =
    { clientRef : String
    , buildId : String
    , protocolVersion : Int
    , storageSchemas : StorageSchemas
    , hasUnsavedDraft : Bool
    , activeCall : Bool
    , pendingPrivateMutation : Bool
    , canActivate : Bool
    }


type alias StorageSchemas =
    { vault : Int
    , privateCrypto : Int
    , platform : Int
    , tabIntents : Int
    , localWorkspaces : Int
    }


type alias Model =
    { status : Status
    , buildId : String
    , clientRef : String
    , state : ActivationState
    , requestId : Maybe String
    , retired : Set String
    }


type Msg
    = ActivationRequested String String
    | ActivationCancelled
    | ClientStateChanged ActivationState
    | RuntimeWorkerStatus Status
    | OwnerRetired String


type Effect
    = RegisterWorker String
    | RequestActivation String String
    | CancelActivation String
    | ReportClientState ActivationState
    | NoEffect


init : { buildId : String, clientRef : String } -> Model
init input =
    { status = Unregistered
    , buildId = input.buildId
    , clientRef = input.clientRef
    , state = { clientRef = input.clientRef, buildId = input.buildId, protocolVersion = 1, storageSchemas = { vault = 5, privateCrypto = 2, platform = 1, tabIntents = 1, localWorkspaces = 1 }, hasUnsavedDraft = False, activeCall = False, pendingPrivateMutation = False, canActivate = True }
    , requestId = Nothing
    , retired = Set.empty
    }


update : Msg -> Model -> ( Model, Effect )
update msg model =
    case msg of
        ActivationRequested requestId targetBuildId ->
            if String.isEmpty requestId || String.isEmpty targetBuildId then
                ( { model | status = Failed "invalid-request" }, NoEffect )

            else
                ( { model | status = Waiting, requestId = Just requestId }, RequestActivation requestId targetBuildId )

        ActivationCancelled ->
            case model.requestId of
                Just requestId ->
                    ( { model | status = Waiting, requestId = Nothing }, CancelActivation requestId )

                Nothing ->
                    ( model, NoEffect )

        ClientStateChanged state ->
            if state.clientRef /= model.clientRef || state.protocolVersion /= 1 || state.storageSchemas /= { vault = 5, privateCrypto = 2, platform = 1, tabIntents = 1, localWorkspaces = 1 } then
                ( model, NoEffect )

            else
                let
                    next = { model | state = state }
                in
                ( next, ReportClientState state )

        RuntimeWorkerStatus status ->
            ( { model | status = status }, NoEffect )

        OwnerRetired ownerRef ->
            ( { model | retired = Set.insert ownerRef model.retired, requestId = Nothing }, NoEffect )


retire : String -> Model -> Model
retire ownerRef model =
    { model | retired = Set.insert ownerRef model.retired, requestId = Nothing }
