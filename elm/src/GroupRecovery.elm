module GroupRecovery exposing (Model, Msg(..), State, Step(..), init, update)

{-| Recovery projections contain only public status. File handles, bytes,
passphrases, device keys, and account credentials stay in the private runtime.
-}

import Dict exposing (Dict)
import Ids exposing (AccountGeneration, ConnectionGeneration, ConversationId, OwnerRef, RequestId)


type Step
    = NoRecovery
    | Enrolling
    | DeviceVerified
    | RequestingWelcome
    | WelcomePending
    | RotatingMembership
    | ExportingBackup
    | ImportingBackup
    | Installed
    | DeliveryUnknown
    | RecoveryBlocked String
    | RecoveryFailed String


type alias OwnerVersion = { ownerRef : OwnerRef, accountGeneration : AccountGeneration, connectionGeneration : ConnectionGeneration }
type alias State = { requestId : RequestId, conversationId : Maybe ConversationId, step : Step, epoch : Maybe Int, explicitIntent : Bool }
type alias Model = { owner : Maybe OwnerVersion, active : Maybe State, states : Dict String State }


type Msg
    = OwnerChanged OwnerVersion
    | IntentStarted { requestId : RequestId, owner : OwnerVersion, conversationId : Maybe ConversationId, step : Step }
    | ExplicitIntentConfirmed RequestId
    | StateReceived { requestId : RequestId, owner : OwnerVersion, step : Step, epoch : Maybe Int }
    | Dismiss RequestId


init : Model
init = { owner = Nothing, active = Nothing, states = Dict.empty }


update : Msg -> Model -> Model
update msg model =
    case msg of
        OwnerChanged owner -> { owner = Just owner, active = Nothing, states = Dict.empty }

        IntentStarted request ->
            if model.owner == Just request.owner then
                let state = { requestId = request.requestId, conversationId = request.conversationId, step = request.step, epoch = Nothing, explicitIntent = False }
                    key = Ids.requestIdToRuntime request.requestId
                in { model | active = Just state, states = bounded (Dict.insert key state model.states) }
            else model

        ExplicitIntentConfirmed requestId -> updateState requestId (\state -> { state | explicitIntent = True }) model

        StateReceived response ->
            if model.owner /= Just response.owner then model
            else updateState response.requestId (\state -> { state | step = response.step, epoch = response.epoch }) model

        Dismiss requestId -> updateState requestId (\state -> { state | explicitIntent = False }) model


updateState : RequestId -> (State -> State) -> Model -> Model
updateState requestId change model =
    let key = Ids.requestIdToRuntime requestId
    in case Dict.get key model.states of
        Nothing -> model
        Just old ->
            let updated = change old
                active = case model.active of
                    Just current -> if current.requestId == requestId then Just updated else model.active
                    Nothing -> Just updated
            in { model | active = active, states = bounded (Dict.insert key updated model.states) }


bounded : Dict String State -> Dict String State
bounded states = states |> Dict.toList |> List.reverse |> List.take 24 |> Dict.fromList
