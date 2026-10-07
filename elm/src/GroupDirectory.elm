module GroupDirectory exposing
    ( Admission(..)
    , AdmissionReason(..)
    , Collector
    , DerivedRow
    , DirectoryEntry
    , DirectoryRecord
    , Snapshot
    , SnapshotLine(..)
    , acceptLine
    , admitSigner
    , blankCollector
    , decodeEntry
    , directoryAlgorithm
    , directoryMagic
    , directorySuite
    , encodeEntry
    , finishCollector
    , isComplete
    , isFailed
    , markDerived
    , maxDirectoryEntries
    , parseSnapshotLine
    )

{-| Group device-directory (ODD1) surface — Elm port of the pure parts of
`src/lib/e2ee/groupDeviceDirectory.ts` (ODD1 entry codec, `E2EEKEY`
snapshot lines, bounded collector) and the synchronous half of the
admission checks in `src/lib/e2ee/trustedGroupSigner.ts`.

Split of responsibilities, mirroring the oracle:

  - Structural ODD1 decode (magic/suite/sizes) runs here eagerly at
    collect time; rows stay `legacy`/`trusted = False` until derivation.
  - P-256 curve membership (`y^2 = x^3 - 3x + b`) needs big-int math Elm
    `Int` cannot do, so it is enforced ports-side (WebCrypto import)
    before any trust verdict — exactly like the oracle's decode gate.
  - The `ogc1-…` device-id derivation is SHA-256, so trust marking
    (`trusted = True`) arrives from ports; admission below only admits
    rows already marked trusted.

Fail-closed throughout: every negative path is `Nothing`/`Rejected`,
never a provisional trust.

-}

import Base64Url
import Dict exposing (Dict)


directoryMagic : String
directoryMagic =
    "ODD1"


directorySuite : Int
directorySuite =
    1


directoryAlgorithm : String
directoryAlgorithm =
    "onyx-ogc1-v1"


{-| ODD1 binary size: magic(4) + suite(1) + signer(32) + encryption(65). -}
directoryEntryBytes : Int
directoryEntryBytes =
    102


maxDirectoryEntries : Int
maxDirectoryEntries =
    64


{-| Raw ODD1 key pair: 32-byte Ed25519 signer, 65-byte uncompressed
SEC1 P-256 encryption key.
-}
type alias DirectoryEntry =
    { signerPub : List Int
    , encryptionPub : List Int
    }


{-| One collected directory row. `trusted` is only ever set by the
ports derivation verdict (strict re-decode plus derived-id match);
`legacy` mirrors the oracle (`not trusted`).
-}
type alias DirectoryRecord =
    { account : String
    , deviceId : String
    , algorithm : String
    , publicKey : String
    , directoryKey : Maybe String
    , trusted : Bool
    , legacy : Bool
    , entry : Maybe DirectoryEntry
    }


type SnapshotLine
    = DeviceLine { account : String, deviceId : String, algorithm : String, publicKey : String }
    | EndLine { account : String, count : Int }


type alias Snapshot =
    { account : String
    , devices : List DirectoryRecord
    , trusted : List DirectoryRecord
    , bySigner : Dict String DirectoryRecord
    }


type AdmissionReason
    = DeviceAbsent
    | SignerMismatch
    | BadDirectoryEntry
    | UnsupportedAlgorithm


type Admission
    = Admitted DirectoryRecord
    | Rejected AdmissionReason


type alias Collector =
    { account : Maybe String
    , rows : List DirectoryRecord
    , ended : Bool
    , failed : Bool
    , expectedCount : Maybe Int
    }


blankCollector : Collector
blankCollector =
    { account = Nothing
    , rows = []
    , ended = False
    , failed = False
    , expectedCount = Nothing
    }


isFailed : Collector -> Bool
isFailed collector =
    collector.failed


isComplete : Collector -> Bool
isComplete collector =
    collector.ended && not collector.failed


isAccountChar : Char -> Bool
isAccountChar c =
    Char.isAlphaNum c || c == '_' || c == '.' || c == '@' || c == '-'


isDeviceChar : Char -> Bool
isDeviceChar c =
    Char.isAlphaNum c || c == '_' || c == '.' || c == '-'


isSnapshotKeyChar : Char -> Bool
isSnapshotKeyChar c =
    c >= 'a' && c <= 'z'


isTokenChar : Char -> Bool
isTokenChar c =
    Char.isAlphaNum c || c == '_' || c == '.' || c == ':' || c == '@' || c == '+' || c == '/' || c == '=' || c == '-'


validAccount : String -> Bool
validAccount value =
    String.length value >= 1
        && String.length value <= 64
        && List.all isAccountChar (String.toList value)


validDeviceId : String -> Bool
validDeviceId value =
    String.length value >= 1
        && String.length value <= 32
        && List.all isDeviceChar (String.toList value)


validToken : String -> Bool
validToken value =
    String.length value >= 1
        && String.length value <= 4096
        && List.all isTokenChar (String.toList value)


{-| Structural P-256 uncompressed-point shape: 65 bytes, `0x04` prefix.
Full curve membership is enforced ports-side before trust.
-}
validEncryptionShape : List Int -> Bool
validEncryptionShape bytes =
    List.length bytes == 65 && List.head bytes == Just 4


hasNonZeroByte : List Int -> Bool
hasNonZeroByte bytes =
    List.any (\b -> b /= 0) bytes


{-| Decode a canonical base64url ODD1 token. Structural only: magic,
suite, 32-byte nonzero signer, 65-byte `0x04`-prefixed encryption key.
-}
decodeEntry : String -> Maybe DirectoryEntry
decodeEntry wire =
    if String.isEmpty wire then
        Nothing

    else
        case Base64Url.decode wire of
            Nothing ->
                Nothing

            Just raw ->
                if Base64Url.encode raw /= wire then
                    Nothing

                else if List.length raw /= directoryEntryBytes then
                    Nothing

                else if List.take 4 raw /= Base64Url.utf8Bytes directoryMagic then
                    Nothing

                else if List.head (List.drop 4 raw) /= Just directorySuite then
                    Nothing

                else
                    let
                        signerPub =
                            List.take 32 (List.drop 5 raw)

                        encryptionPub =
                            List.drop 37 raw
                    in
                    if not (hasNonZeroByte signerPub) then
                        Nothing

                    else if not (validEncryptionShape encryptionPub) then
                        Nothing

                    else
                        Just { signerPub = signerPub, encryptionPub = encryptionPub }


{-| Pack an entry to canonical base64url. Rejects zero signers and
misshapen encryption keys, mirroring `packGroupDeviceDirectoryEntry`.
-}
encodeEntry : DirectoryEntry -> Maybe String
encodeEntry entry =
    if List.length entry.signerPub /= 32 || not (hasNonZeroByte entry.signerPub) then
        Nothing

    else if not (validEncryptionShape entry.encryptionPub) then
        Nothing

    else
        let
            raw =
                Base64Url.utf8Bytes directoryMagic
                    ++ [ directorySuite ]
                    ++ entry.signerPub
                    ++ entry.encryptionPub

            wire =
                Base64Url.encode raw
        in
        if Base64Url.decode wire == Just raw then
            Just wire

        else
            Nothing


splitField : String -> Maybe ( String, String )
splitField field =
    case String.indexes "=" field of
        [] ->
            Nothing

        i :: _ ->
            if i <= 0 || i == String.length field - 1 then
                Nothing

            else
                Just ( String.slice 0 i field, String.dropLeft (i + 1) field )


collectFields : List String -> Dict String String -> Maybe (Dict String String)
collectFields fields acc =
    case fields of
        [] ->
            Just acc

        field :: rest ->
            case splitField field of
                Nothing ->
                    Nothing

                Just ( key, value ) ->
                    if String.isEmpty key || not (List.all isSnapshotKeyChar (String.toList key)) then
                        Nothing

                    else if not (validToken value) then
                        Nothing

                    else if Dict.member key acc then
                        Nothing

                    else
                        collectFields rest (Dict.insert key value acc)


{-| Parse one `E2EEKEY DEVICE …` / `E2EEKEY END …` reply-body line.
IRC framing is rejected: the body must start at `E2EEKEY`.
-}
parseSnapshotLine : String -> Maybe SnapshotLine
parseSnapshotLine input =
    let
        words =
            String.words (String.trim input)
    in
    case words of
        "E2EEKEY" :: verb :: rest ->
            case collectFields rest Dict.empty of
                Nothing ->
                    Nothing

                Just values ->
                    case Dict.get "account" values of
                        Nothing ->
                            Nothing

                        Just account ->
                            if not (validAccount account) then
                                Nothing

                            else if verb == "DEVICE" then
                                parseDeviceLine account values

                            else if verb == "END" then
                                parseEndLine account values

                            else
                                Nothing

        _ ->
            Nothing


parseDeviceLine : String -> Dict String String -> Maybe SnapshotLine
parseDeviceLine account values =
    case ( Dict.get "id" values, Dict.get "alg" values, Dict.get "key" values ) of
        ( Just deviceId, Just algorithm, Just publicKey ) ->
            if Dict.size values /= 4 then
                Nothing

            else if not (validDeviceId deviceId) then
                Nothing

            else if String.length algorithm < 1 || String.length algorithm > 64 then
                Nothing

            else
                Just (DeviceLine { account = account, deviceId = deviceId, algorithm = algorithm, publicKey = publicKey })

        _ ->
            Nothing


parseEndLine : String -> Dict String String -> Maybe SnapshotLine
parseEndLine account values =
    case Dict.get "devices" values of
        Nothing ->
            Nothing

        Just rawCount ->
            if Dict.size values /= 2 then
                Nothing

            else
                case String.toInt rawCount of
                    Nothing ->
                        Nothing

                    Just count ->
                        if not (List.all Char.isDigit (String.toList rawCount)) then
                            Nothing

                        else if String.length rawCount < 1 || String.length rawCount > 2 || count < 0 || count > maxDirectoryEntries then
                            Nothing

                        else
                            Just (EndLine { account = account, count = count })


{-| Materialize a provisional row: ODD1 decodes eagerly when the
algorithm matches, but the row stays untrusted (`legacy`) until the
ports derivation verdict. Mirrors the oracle's provisional retain.
-}
materializeRow : String -> String -> String -> String -> DirectoryRecord
materializeRow account deviceId algorithm publicKey =
    let
        entry =
            if algorithm == directoryAlgorithm then
                decodeEntry publicKey

            else
                Nothing
    in
    { account = account
    , deviceId = deviceId
    , algorithm = algorithm
    , publicKey = publicKey
    , directoryKey = Maybe.map (\parts -> Base64Url.encode parts.signerPub) entry
    , trusted = False
    , legacy = True
    , entry = entry
    }


{-| Admit one authenticated reply-body line. A failed collector stays
failed; the boolean reports whether the line was admitted.
-}
acceptLine : String -> Collector -> ( Collector, Bool )
acceptLine input collector =
    if collector.failed || collector.ended then
        ( collector, False )

    else
        case parseSnapshotLine input of
            Nothing ->
                ( { collector | failed = True }, False )

            Just line ->
                case line of
                    EndLine end ->
                        acceptEnd collector end

                    DeviceLine device ->
                        acceptDevice collector device


acceptEnd : Collector -> { account : String, count : Int } -> ( Collector, Bool )
acceptEnd collector end =
    let
        account =
            case collector.account of
                Just known ->
                    known

                Nothing ->
                    end.account
    in
    if account /= end.account then
        ( { collector | failed = True }, False )

    else if collector.expectedCount /= Nothing || end.count /= List.length collector.rows then
        ( { collector | account = Just account, failed = True }, False )

    else
        ( { collector | account = Just account, expectedCount = Just end.count, ended = True }, True )


acceptDevice : Collector -> { account : String, deviceId : String, algorithm : String, publicKey : String } -> ( Collector, Bool )
acceptDevice collector device =
    let
        account =
            case collector.account of
                Just known ->
                    known

                Nothing ->
                    device.account
    in
    if account /= device.account then
        ( { collector | failed = True }, False )

    else if List.length collector.rows >= maxDirectoryEntries then
        ( { collector | account = Just account, failed = True }, False )

    else if List.any (\row -> row.deviceId == device.deviceId) collector.rows then
        ( { collector | account = Just account, failed = True }, False )

    else
        ( { collector
            | account = Just account
            , rows = collector.rows ++ [ materializeRow device.account device.deviceId device.algorithm device.publicKey ]
          }
        , True
        )


{-| Finalize a complete collector. Duplicate signer keys across trusted
rows fail the snapshot, mirroring `finish()`.
-}
finishCollector : Collector -> Maybe Snapshot
finishCollector collector =
    if collector.failed || not collector.ended then
        Nothing

    else
        case ( collector.account, collector.expectedCount ) of
            ( Just account, Just expected ) ->
                if expected /= List.length collector.rows then
                    Nothing

                else
                    let
                        trusted =
                            List.filter .trusted collector.rows
                    in
                    case buildBySigner trusted Dict.empty of
                        Nothing ->
                            Nothing

                        Just bySigner ->
                            Just { account = account, devices = collector.rows, trusted = trusted, bySigner = bySigner }

            _ ->
                Nothing


buildBySigner : List DirectoryRecord -> Dict String DirectoryRecord -> Maybe (Dict String DirectoryRecord)
buildBySigner rows acc =
    case rows of
        [] ->
            Just acc

        row :: rest ->
            case row.directoryKey of
                Nothing ->
                    buildBySigner rest acc

                Just key ->
                    if Dict.member key acc then
                        Nothing

                    else
                        buildBySigner rest (Dict.insert key row acc)


{-| One ports derivation verdict per advertised device. `trusted` is
only ever true when the strict re-decode (including curve membership)
succeeded and the derived id equals the advertised device id.
-}
type alias DerivedRow =
    { deviceId : String
    , directoryKey : Maybe String
    , derivedId : Maybe String
    , trusted : Bool
    }


{-| Apply ports derivation verdicts to collected rows, mirroring
`materializeRecord`. Trust requires full agreement: the verdict must
be trusted and its strict directory key must equal the collected one.
Anything else stays provisional (`legacy`), and rows ports could not
decode lose their structural entry too.
-}
markDerived : List DirectoryRecord -> List DerivedRow -> List DirectoryRecord
markDerived rows verdicts =
    let
        byDevice =
            Dict.fromList (List.map (\v -> ( v.deviceId, v )) verdicts)

        mark row =
            case Dict.get row.deviceId byDevice of
                Nothing ->
                    { row | trusted = False, legacy = True }

                Just verdict ->
                    if verdict.trusted && verdict.directoryKey /= Nothing && verdict.directoryKey == row.directoryKey then
                        { row | trusted = True, legacy = False, directoryKey = verdict.directoryKey }

                    else
                        { row
                            | trusted = False
                            , legacy = True
                            , directoryKey = verdict.directoryKey
                            , entry =
                                case verdict.directoryKey of
                                    Just _ ->
                                        row.entry

                                    Nothing ->
                                        Nothing
                        }
    in
    List.map mark rows


{-| Synchronous admission: wire signer → trusted row, mirroring the
directory half of `resolveTrustedGroupControl`. Lookup is by signer
key, never by advertised device id; the returned row still needs its
`trusted` derivation mark, which only ports can grant.
-}
admitSigner : List DirectoryRecord -> String -> String -> String -> Admission
admitSigner rows account deviceId wireSigner =
    let
        row =
            List.filter (\candidate -> candidate.directoryKey == Just wireSigner) rows
                |> List.head

        ownerSeen =
            List.any (\candidate -> String.toLower candidate.account == String.toLower account && candidate.deviceId == deviceId) rows
    in
    case row of
        Nothing ->
            if ownerSeen then
                Rejected SignerMismatch

            else
                Rejected DeviceAbsent

        Just found ->
            if String.toLower found.account /= String.toLower account || found.deviceId /= deviceId then
                Rejected SignerMismatch

            else if found.algorithm /= directoryAlgorithm || found.legacy then
                Rejected UnsupportedAlgorithm

            else if not found.trusted then
                Rejected BadDirectoryEntry

            else
                case found.entry of
                    Nothing ->
                        Rejected BadDirectoryEntry

                    Just _ ->
                        Admitted found
