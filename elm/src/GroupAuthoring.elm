module GroupAuthoring exposing (Model, Msg(..), Phase(..), State, init, update)

{-| UI-safe projection of the private group-authoring service. No keys, signed
payloads, directory bytes, or backup passwords cross this Elm boundary.
-}

import Dict exposing (Dict)
import Ids exposing (AccountGeneration, ConnectionGeneration, ConversationId, OwnerRef, RequestId)


type Phase
    = Idle
    | Planning
    | Planned
    | Staging
    | TransportAdmitted
    | CommitObserved
    | LocalInstalled
    | DeliveryUnknown
    | Conflict
    | Failed String
    | Cancelled


type alias OwnerVersion = { ownerRef : OwnerRef, accountGeneration : AccountGeneration, connectionGeneration : ConnectionGeneration }


type alias State =
    { requestId : RequestId
    , conversationId : ConversationId
    , phase : Phase
    , nextEpoch : Maybe Int
    , membershipRevision : Maybe String
    , recipientCount : Int
    , explicitConfirmation : Bool
    }


type alias Model =
    { owner : Maybe OwnerVersion
    , current : Maybe State
    , operations : Dict String State
    , order : List String
    }


type Msg
    = OwnerChanged OwnerVersion
    | PlanStarted { requestId : RequestId, owner : OwnerVersion, conversationId : ConversationId }
    | PlanReceived { requestId : RequestId, owner : OwnerVersion, nextEpoch : Int, membershipRevision : String, recipientCount : Int }
    | ExplicitlyConfirmed RequestId
    | CommitStarted RequestId
    | StatusReceived { requestId : RequestId, owner : OwnerVersion, phase : Phase, reason : Maybe String, epoch : Maybe Int, recipientCount : Int }
    | Cancel RequestId


init : Model
init = { owner = Nothing, current = Nothing, operations = Dict.empty, order = [] }


update : Msg -> Model -> Model
update msg model =
    case msg of
        OwnerChanged owner -> { owner = Just owner, current = Nothing, operations = Dict.empty, order = [] }

        PlanStarted request ->
            if model.owner == Just request.owner then
                let state = { requestId = request.requestId, conversationId = request.conversationId, phase = Planning, nextEpoch = Nothing, membershipRevision = Nothing, recipientCount = 0, explicitConfirmation = False }
                    ( order, operations ) = makeRoom model.order model.operations
                    key = Ids.requestIdToRuntime request.requestId
                in if Dict.member key operations || Dict.size operations >= 32 then model
                   else { model | current = Just state, operations = Dict.insert key state operations, order = order ++ [ key ] }
            else model

        PlanReceived response ->
            if model.owner /= Just response.owner then model
            else updateState response.requestId (\s -> if transitionAllowed s.phase Planned then { s | phase = Planned, nextEpoch = Just response.nextEpoch, membershipRevision = Just response.membershipRevision, recipientCount = clamp 0 256 response.recipientCount } else s) model

        ExplicitlyConfirmed requestId -> updateState requestId (\s -> if s.phase == Planned then { s | explicitConfirmation = True } else s) model

        CommitStarted requestId -> updateState requestId (\s -> if s.phase == Planned && s.explicitConfirmation then { s | phase = Staging } else s) model

        StatusReceived response ->
            if model.owner /= Just response.owner then model
            else updateState response.requestId (\s -> if transitionAllowed s.phase response.phase then { s | phase = response.phase, nextEpoch = response.epoch, recipientCount = clamp 0 256 response.recipientCount } else s) model

        Cancel requestId -> updateState requestId (\s -> { s | phase = if s.phase == TransportAdmitted || s.phase == DeliveryUnknown || s.phase == CommitObserved then DeliveryUnknown else Cancelled, explicitConfirmation = False }) model


updateState : RequestId -> (State -> State) -> Model -> Model
updateState requestId change model =
    let key = Ids.requestIdToRuntime requestId
    in case Dict.get key model.operations of
        Nothing -> model
        Just old ->
            let updated = change old
                operations = Dict.insert key updated model.operations
                current = case model.current of
                    Just active -> if active.requestId == requestId then Just updated else model.current
                    Nothing -> Just updated
            in { model | current = current, operations = operations }


makeRoom : List String -> Dict String State -> ( List String, Dict String State )
makeRoom order operations =
    if Dict.size operations < 32 then
        ( order, operations )
    else
        case List.filter (\key -> Dict.get key operations |> Maybe.map (.phase >> terminal) |> Maybe.withDefault False) order |> List.head of
            Nothing -> ( order, operations )
            Just key -> ( List.filter ((/=) key) order, Dict.remove key operations )


terminal : Phase -> Bool
terminal phase =
    case phase of
        LocalInstalled -> True
        Failed _ -> True
        Cancelled -> True
        _ -> False


transitionAllowed : Phase -> Phase -> Bool
transitionAllowed before after =
    case before of
        Idle -> after == Planning || isFailure after
        Planning -> after == Planned || isFailure after || after == Cancelled
        Planned -> after == Staging || isFailure after || after == Cancelled
        Staging -> after == TransportAdmitted || after == DeliveryUnknown || isFailure after || after == Cancelled
        LocalInstalled -> False
        Failed _ -> False
        Cancelled -> False
        DeliveryUnknown -> after == DeliveryUnknown || after == CommitObserved || after == LocalInstalled
        TransportAdmitted -> after == TransportAdmitted || after == DeliveryUnknown || after == CommitObserved || after == LocalInstalled
        CommitObserved -> after == CommitObserved || after == DeliveryUnknown || after == LocalInstalled
        Conflict -> isFailure after || after == Cancelled


isFailure : Phase -> Bool
isFailure phase =
    case phase of
        Failed _ -> True
        _ -> False
