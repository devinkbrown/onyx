module DeliveryJournal exposing (EntryState(..), Model, Msg(..), OwnerVersion, QueueState(..), init, update)

import Dict exposing (Dict)
import Ids exposing (AccountGeneration, ConnectionGeneration, OwnerRef, RequestId)


type QueueState = QueueIdle | QueueFlushing | QueueBlocked | QueueUnavailable | QueueStaleOwner

type EntryState = Queued | Dispatching | TransportAdmitted | ServerAccepted | DeliveryUnknown | ExpiredReview | Discarded

type alias OwnerVersion = { ownerRef : OwnerRef, accountGeneration : AccountGeneration, connectionGeneration : ConnectionGeneration }
type alias Entry = { state : EntryState, generation : RequestId }
type alias Model =
    { owner : Maybe OwnerVersion, state : QueueState, entries : Dict String Entry, flushRequest : Maybe RequestId }

type Msg
    = OwnerSelected OwnerVersion
    | FlushStarted { requestId : RequestId, owner : OwnerVersion }
    | EntryObserved { requestId : RequestId, owner : OwnerVersion, clientIntentId : String, state : EntryState, correlatedAcceptance : Bool }
    | FlushFinished { requestId : RequestId, owner : OwnerVersion, state : QueueState }
    | OwnerRetired

init : Model
init = { owner = Nothing, state = QueueIdle, entries = Dict.empty, flushRequest = Nothing }

update : Msg -> Model -> Model
update msg model =
    case msg of
        OwnerSelected owner -> { owner = Just owner, state = QueueIdle, entries = Dict.empty, flushRequest = Nothing }
        FlushStarted request ->
            if model.owner == Just request.owner then { model | state = QueueFlushing, flushRequest = Just request.requestId } else model
        EntryObserved event ->
            if model.owner /= Just event.owner || not (validRef event.clientIntentId) then model
            else
                let key = event.clientIntentId
                    previous = Dict.get key model.entries
                    allowed = case previous of
                        Nothing -> event.state == Queued || event.state == Dispatching
                        Just entry -> transitionAllowed entry.state event.state event.correlatedAcceptance && (entry.generation == event.requestId || terminal entry.state)
                    updated = if allowed then Dict.insert key { state = event.state, generation = event.requestId } model.entries else model.entries
                in { model | entries = boundedEntries updated }
        FlushFinished response ->
            if model.owner == Just response.owner && model.flushRequest == Just response.requestId then { model | state = response.state, flushRequest = Nothing } else model
        OwnerRetired -> { owner = Nothing, state = QueueStaleOwner, entries = Dict.empty, flushRequest = Nothing }

transitionAllowed : EntryState -> EntryState -> Bool -> Bool
transitionAllowed before after proven =
    case before of
        Queued -> after == Dispatching || after == ExpiredReview || after == Discarded
        Dispatching -> after == Queued || after == TransportAdmitted || after == DeliveryUnknown || after == ExpiredReview
        TransportAdmitted -> after == ServerAccepted && proven
        DeliveryUnknown -> after == ServerAccepted && proven
        ExpiredReview -> after == Discarded
        ServerAccepted -> False
        Discarded -> False

terminal : EntryState -> Bool
terminal state = state == DeliveryUnknown || state == ServerAccepted || state == Discarded

boundedEntries : Dict String Entry -> Dict String Entry
boundedEntries entries = entries |> Dict.toList |> List.reverse |> List.take 100 |> Dict.fromList

validRef : String -> Bool
validRef value = String.length value >= 22 && String.length value <= 128 && String.all (\char -> Char.isAlphaNum char || char == '-' || char == '_') value
