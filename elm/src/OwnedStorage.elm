module OwnedStorage exposing (MessageRow, Model, Msg(..), Outcome(..), Status(..), init, update)

import Dict exposing (Dict)
import Ids exposing (AccountGeneration, ConversationId, OwnerRef, RequestId, ConnectionGeneration)


type Status = Unopened | Ready | Unavailable | BlockedUpgrade | Quota | StaleOwner | Invalid

type Outcome = Loaded | Saved | Cleared | Failed String

type alias OwnerVersion = { ownerRef : OwnerRef, accountGeneration : AccountGeneration, connectionGeneration : ConnectionGeneration }

type alias MessageRow =
    { recordId : String, messageId : Maybe String, conversationId : ConversationId, from : String, body : String
    , atMs : Int, serverTime : Maybe String, deleted : Bool, redacted : Bool, privacy : String }

type alias Model =
    { status : Status, currentOwner : Maybe OwnerVersion, requestOwners : Dict String OwnerVersion
    , rows : Dict String (List MessageRow), lastOutcome : Maybe Outcome, quarantinePending : Int }

type Msg
    = RequestStarted { requestId : RequestId, owner : OwnerVersion }
    | StatusReceived { owner : OwnerVersion, status : Status, quarantinePending : Int }
    | RowsReceived { requestId : RequestId, owner : OwnerVersion, conversationId : ConversationId, rows : List MessageRow }
    | WriteReceived { requestId : RequestId, owner : OwnerVersion, affected : Int, status : Status }
    | OwnerChanged OwnerVersion

init : Model
init =
    { status = Unopened, currentOwner = Nothing, requestOwners = Dict.empty, rows = Dict.empty, lastOutcome = Nothing, quarantinePending = 0 }

update : Msg -> Model -> Model
update msg model =
    case msg of
        RequestStarted request ->
            let pending = Dict.insert (Ids.requestIdToRuntime request.requestId) request.owner model.requestOwners
            in { model | currentOwner = Just request.owner, requestOwners = keepNewest 32 pending }

        StatusReceived response ->
            if model.currentOwner == Just response.owner then { model | status = response.status, quarantinePending = max 0 response.quarantinePending } else model

        RowsReceived response ->
            let requestKey = Ids.requestIdToRuntime response.requestId
            in if model.currentOwner == Just response.owner && Dict.get requestKey model.requestOwners == Just response.owner then
                { model | rows = keepRows 16 (Ids.conversationIdToWire response.conversationId) (List.take 400 response.rows) model.rows
                , requestOwners = Dict.remove requestKey model.requestOwners, lastOutcome = Just Loaded }
               else model

        WriteReceived response ->
            let requestKey = Ids.requestIdToRuntime response.requestId
            in if model.currentOwner == Just response.owner && Dict.get requestKey model.requestOwners == Just response.owner then
                { model | status = response.status, requestOwners = Dict.remove requestKey model.requestOwners
                , lastOutcome = if response.status == Ready then Just (if response.affected > 0 then Saved else Cleared) else Just (Failed (statusCode response.status)) }
               else model

        OwnerChanged owner ->
            { model | currentOwner = Just owner, rows = Dict.empty, requestOwners = Dict.empty, lastOutcome = Nothing, status = StaleOwner }

keepNewest : Int -> Dict comparable value -> Dict comparable value
keepNewest maximum values =
    values |> Dict.toList |> List.reverse |> List.take maximum |> Dict.fromList

keepRows : Int -> String -> List MessageRow -> Dict String (List MessageRow) -> Dict String (List MessageRow)
keepRows maximum key rows existing =
    let updated = Dict.insert key rows existing
    in updated |> Dict.toList |> List.take maximum |> Dict.fromList

statusCode : Status -> String
statusCode status =
    case status of
        Unopened -> "unopened"
        Ready -> "ready"
        Unavailable -> "unavailable"
        BlockedUpgrade -> "blocked-upgrade"
        Quota -> "quota"
        StaleOwner -> "stale-owner"
        Invalid -> "invalid"
