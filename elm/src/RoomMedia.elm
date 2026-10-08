module RoomMedia exposing
    ( MediaRow
    , RoomMediaEntry
    , RoomMediaFilter(..)
    , RoomMediaIndex
    , emptyCopy
    , indexRoomMedia
    , itemsForFilter
    , linkDomain
    , mergeRoomHistory
    , readableMessageBody
    )

{-| Room media index, mirroring `src/lib/upload/roomMediaIndex.ts`
(Pictures · Files · Links over this-device history: no OpenGraph
fetch, no dest unfurl, no gallery write).

Narrowings: rows arrive as narrow `MediaRow` records (the App maps
live rows onto them); times are millisecond stamps, not `Date`s;
`linkDomain` hand-parses the authority (no `URL` in Elm) — garbage
without a scheme falls back to the href where the oracle would report
its base hostname, unreachable through `extractHttpUrls`; Elm rows
never carry the `action` type, so the indexable set matches it only
vacuously.
-}

import Dict
import Set
import Upload


{-| The row fields the index reads (mirrors the `ChatMessage` fields
`roomMediaIndex` touches: `encrypted` stands in for the oracle
`hasEncryptedMessageBoundary` check, resolved App-side). -}
type alias MediaRow =
    { id : String
    , from : String
    , body : String
    , plaintext : Maybe String
    , msgType : String
    , at : Int
    , deleted : Bool
    , redacted : Bool
    , encrypted : Bool
    }


{-| One indexed item: pictures and files carry attachment names while
links carry the display domain. -}
type alias RoomMediaEntry =
    { kind : RoomMediaFilter
    , id : String
    , messageId : String
    , href : String
    , name : Maybe String
    , sizeLabel : Maybe String
    , domain : Maybe String
    , from : String
    , at : Int
    }


{-| The three index filters (doubling as entry kinds). -}
type RoomMediaFilter
    = Pictures
    | Files
    | Links


{-| Pictures, files, and links, newest first. -}
type alias RoomMediaIndex =
    { pictures : List RoomMediaEntry
    , files : List RoomMediaEntry
    , links : List RoomMediaEntry
    }


{-| Message types the index reads (mirrors `INDEXABLE_TYPES`). -}
indexableTypes : List String
indexableTypes =
    [ "msg", "action", "notice", "whisper" ]


{-| Empty-filter copy (mirrors `ROOM_MEDIA_EMPTY`). -}
emptyCopy : RoomMediaFilter -> String
emptyCopy filter =
    case filter of
        Pictures ->
            "No pictures from this conversation are on this device."

        Files ->
            "No files from this conversation are on this device."

        Links ->
            "No links from this conversation are on this device."


{-| The indexable body of a row: tombstones yield nothing, locked
envelope rows yield their transient plaintext exclusively (never
ciphertext), and non-chat rows yield nothing. -}
readableMessageBody : MediaRow -> Maybe String
readableMessageBody row =
    if row.deleted || row.redacted then
        Nothing

    else if not (List.member row.msgType indexableTypes) then
        Nothing

    else if row.encrypted then
        row.plaintext

    else
        Just row.body


{-| Display host of an absolute http(s) href (mirrors `linkDomain`:
real hostname, port stripped; unparseable input falls back to the
href). -}
linkDomain : String -> String
linkDomain href =
    case String.split "://" href of
        _ :: remainder ->
            case remainder of
                [] ->
                    href

                _ ->
                    case linkHost (String.join "://" remainder) of
                        Just host ->
                            host

                        Nothing ->
                            href

        [] ->
            href


linkHost : String -> Maybe String
linkHost afterScheme =
    let
        authority =
            takeUntilAny [ '/', '?', '#' ] afterScheme

        withoutUserinfo =
            case List.reverse (String.split "@" authority) of
                bare :: _ ->
                    bare

                [] ->
                    authority

        host =
            if String.startsWith "[" withoutUserinfo then
                case String.split "]" withoutUserinfo of
                    first :: _ ->
                        first ++ "]"

                    [] ->
                        withoutUserinfo

            else
                case String.split ":" withoutUserinfo of
                    first :: _ ->
                        first

                    [] ->
                        withoutUserinfo
    in
    if String.isEmpty host then
        Nothing

    else
        Just host


takeUntilAny : List Char -> String -> String
takeUntilAny stops value =
    let
        go chars acc =
            case chars of
                [] ->
                    acc

                char :: rest ->
                    if List.member char stops then
                        acc

                    else
                        go rest (acc ++ String.fromChar char)
    in
    go (String.toList value) ""


{-| Merge vault rows under live rows: live wins per id, oldest first
(mirrors `mergeRoomHistory`). -}
mergeRoomHistory : List MediaRow -> List MediaRow -> List MediaRow
mergeRoomHistory live vault =
    let
        both =
            vault ++ live

        orderedIds =
            List.foldl
                (\row ( seen, ids ) ->
                    if Set.member row.id seen then
                        ( seen, ids )

                    else
                        ( Set.insert row.id seen, ids ++ [ row.id ] )
                )
                ( Set.empty, [] )
                both
                |> Tuple.second

        byId =
            List.foldl (\row acc -> Dict.insert row.id row acc) Dict.empty both
    in
    List.filterMap (\id -> Dict.get id byId) orderedIds
        |> List.sortBy .at


{-| Filter the merged history into pictures, files, and links
(mirrors `indexRoomMedia`: attachment receipts first with
attached-href dedupe, then caption links skipping claimed hrefs;
image links picture, video/audio file, the rest link; newest first). -}
indexRoomMedia : List MediaRow -> RoomMediaIndex
indexRoomMedia rows =
    let
        step row acc =
            case readableMessageBody row of
                Nothing ->
                    acc

                Just body ->
                    let
                        presented =
                            Upload.extractAttachmentPresentation body

                        afterAttachments =
                            List.foldl (addAttachment row) acc presented.attachments

                        claimed =
                            Set.fromList (List.map .url presented.attachments)
                    in
                    List.foldl (addCaptionLink row claimed) afterAttachments (Upload.extractHttpUrls presented.caption)

        empty =
            { pictures = [], files = [], links = [], seen = Set.empty }

        done =
            List.foldl step empty rows
    in
    -- Cons-build over oldest-first input lands newest first, matching
    -- the oracle's push-then-reverse.
    { pictures = done.pictures
    , files = done.files
    , links = done.links
    }


type alias IndexAcc =
    { pictures : List RoomMediaEntry
    , files : List RoomMediaEntry
    , links : List RoomMediaEntry
    , seen : Set.Set String
    }


claimHref : MediaRow -> String -> IndexAcc -> Maybe IndexAcc
claimHref row href acc =
    let
        entryId =
            row.id ++ ":" ++ href
    in
    if Set.member entryId acc.seen then
        Nothing

    else
        Just { acc | seen = Set.insert entryId acc.seen }


addAttachment : MediaRow -> Upload.ParsedAttachment -> IndexAcc -> IndexAcc
addAttachment row attachment acc =
    case claimHref row attachment.url acc of
        Nothing ->
            acc

        Just claimed ->
            let
                entry =
                    { kind = Pictures
                    , id = row.id ++ ":" ++ attachment.url
                    , messageId = row.id
                    , href = attachment.url
                    , name = attachment.name
                    , sizeLabel = attachment.sizeLabel
                    , domain = Nothing
                    , from = row.from
                    , at = row.at
                    }
            in
            case attachment.kind of
                Upload.KindImage ->
                    { claimed | pictures = entry :: claimed.pictures }

                _ ->
                    { claimed | files = { entry | kind = Files } :: claimed.files }


addCaptionLink : MediaRow -> Set.Set String -> String -> IndexAcc -> IndexAcc
addCaptionLink row claimed href acc =
    if Set.member href claimed then
        acc

    else
        case claimHref row href acc of
            Nothing ->
                acc

            Just taken ->
                let
                    base =
                        { kind = Links
                        , id = row.id ++ ":" ++ href
                        , messageId = row.id
                        , href = href
                        , name = Nothing
                        , sizeLabel = Nothing
                        , domain = Nothing
                        , from = row.from
                        , at = row.at
                        }
                in
                case Upload.classifyAttachmentKind href Nothing of
                    Upload.KindImage ->
                        { taken | pictures = { base | kind = Pictures } :: taken.pictures }

                    Upload.KindVideo ->
                        { taken | files = { base | kind = Files } :: taken.files }

                    Upload.KindAudio ->
                        { taken | files = { base | kind = Files } :: taken.files }

                    Upload.KindFile ->
                        { taken | links = { base | domain = Just (linkDomain href) } :: taken.links }


{-| The items under one filter (mirrors `itemsForFilter`). -}
itemsForFilter : RoomMediaIndex -> RoomMediaFilter -> List RoomMediaEntry
itemsForFilter index filter =
    case filter of
        Pictures ->
            index.pictures

        Files ->
            index.files

        Links ->
            index.links
