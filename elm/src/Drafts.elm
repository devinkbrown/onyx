module Drafts exposing (Model, Msg(..), SaveState(..), init, update)

{-| Composer draft status. Text stays with the active composer/private JS
owner; this module only tracks request generations and save outcomes.
-}

import Dict exposing (Dict)


type SaveState
    = Clean
    | Saving
    | SavedEncrypted
    | MemoryOnlyUnsaved
    | QuotaFailed
    | Unavailable
    | StaleOwner


type alias Model =
    { ownerRef : Maybe String
    , latestRevision : Int
    , pending : Dict String Int
    , state : SaveState
    }


type Msg
    = OwnerChanged String
    | SaveStarted { requestId : String, revision : Int, ownerRef : String }
    | SaveFinished { requestId : String, revision : Int, ownerRef : String, state : SaveState }
    | DraftEdited Int


init : Model
init =
    { ownerRef = Nothing, latestRevision = 0, pending = Dict.empty, state = Clean }


update : Msg -> Model -> Model
update msg model =
    case msg of
        OwnerChanged ownerRef ->
            { ownerRef = Just ownerRef, latestRevision = 0, pending = Dict.empty, state = StaleOwner }

        DraftEdited revision ->
            if revision >= model.latestRevision then { model | latestRevision = revision, state = Saving } else model

        SaveStarted request ->
            if model.ownerRef == Just request.ownerRef && request.revision >= model.latestRevision then
                { model | latestRevision = request.revision, pending = Dict.insert request.requestId request.revision model.pending, state = Saving }

            else
                model

        SaveFinished response ->
            if model.ownerRef == Just response.ownerRef && Dict.get response.requestId model.pending == Just response.revision && response.revision == model.latestRevision then
                { model | pending = Dict.remove response.requestId model.pending, state = response.state }

            else
                { model | pending = Dict.remove response.requestId model.pending }
