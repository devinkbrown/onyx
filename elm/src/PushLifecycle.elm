module PushLifecycle exposing (Effect(..), Model, Msg(..), PublicStatus, Registration(..), init, retire, update)

{-| Public notification settings fold. Endpoint keys, native subscriptions,
server tokens, and owner bindings never enter these Elm records.
-}

type Registration
    = None
    | Pending
    | Registered
    | RemovalPending
    | Unknown
    | Failed


type alias PublicStatus =
    { permission : String
    , browserSubscription : String
    , serverRegistration : Registration
    , deliveryObserved : Bool
    , reason : Maybe String
    }


type alias Model =
    { status : PublicStatus
    , requestId : Maybe String
    , retired : Bool
    }


type Msg
    = EnableRequested String
    | DisableRequested String
    | ReconcileRequested String
    | RuntimeStatusReceived PublicStatus
    | OwnerRetired


type Effect
    = RequestEnable String
    | RequestDisable String
    | RequestReconcile String
    | NoEffect


init : Model
init =
    { status = { permission = "default", browserSubscription = "unknown", serverRegistration = Unknown, deliveryObserved = False, reason = Nothing }
    , requestId = Nothing
    , retired = False
    }


update : Msg -> Model -> ( Model, Effect )
update msg model =
    case msg of
        EnableRequested requestId ->
            let
                status =
                    model.status
            in
            ( { model | requestId = Just requestId, status = { status | serverRegistration = Pending, reason = Nothing }, retired = False }, RequestEnable requestId )

        DisableRequested requestId ->
            let
                status =
                    model.status
            in
            ( { model | requestId = Just requestId, status = { status | serverRegistration = RemovalPending, reason = Nothing } }, RequestDisable requestId )

        ReconcileRequested requestId ->
            ( { model | requestId = Just requestId }, RequestReconcile requestId )

        RuntimeStatusReceived status ->
            if model.retired then
                ( model, NoEffect )

            else
                ( { model | status = status, requestId = Nothing }, NoEffect )

        OwnerRetired ->
            let
                status =
                    model.status
            in
            ( { model | requestId = Nothing, retired = True, status = { status | serverRegistration = Unknown, reason = Just "account-changed" } }, NoEffect )


retire : Model -> Model
retire model =
    let
        status =
            model.status
    in
    { model | requestId = Nothing, retired = True, status = { status | serverRegistration = Unknown, reason = Just "account-changed" } }
