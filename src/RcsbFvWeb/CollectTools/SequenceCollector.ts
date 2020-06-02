import {
    RcsbFvDisplayConfigInterface,
    RcsbFvDisplayTypes,
    RcsbFvRowConfigInterface,
    RcsbFvTrackDataElementInterface
} from 'rcsb-saguaro';

import {
    AlignedRegion,
    AlignmentResponse,
    QueryAlignmentArgs,
    SequenceReference,
    TargetAlignment
} from "../../RcsbGraphQL/Types/Borrego/GqlTypes";
import {RcsbFvQuery} from "../../RcsbGraphQL/RcsbFvQuery";
import {RcsbAnnotationConstants} from "../../RcsbAnnotationConfig/RcsbAnnotationConstants";
import {TagDelimiter} from "../Utils/TagDelimiter";
import {AnnotationCollector} from "./AnnotationCollector";

interface CollectAlignmentInterface extends QueryAlignmentArgs {
    filterByTargetContains?:string;
    dynamicDisplay?: boolean;
    sequenceTrackTitle?:string;
}

export interface SequenceCollectorDataInterface {
    sequence: Array<RcsbFvRowConfigInterface>;
    alignment: Array<RcsbFvRowConfigInterface>;
}

interface BuildAlignementsInterface {
    targetAlignmentList: Array<TargetAlignment>;
    querySequence: string;
    filterByTargetContains?:string;
    to:string;
    from:string;
}

export class SequenceCollector {

    private rcsbFvQuery: RcsbFvQuery = new RcsbFvQuery();
    private seqeunceConfigData: Array<RcsbFvRowConfigInterface> = new Array<RcsbFvRowConfigInterface>();
    private alignmentsConfigData: Array<RcsbFvRowConfigInterface> = new Array<RcsbFvRowConfigInterface>();
    private sequenceLength: number;
    private targets: Array<string> = new Array<string>();
    private finished: boolean = false;
    private dynamicDisplay: boolean = false;
    private to: string;

    public collect(requestConfig: CollectAlignmentInterface): Promise<SequenceCollectorDataInterface> {
        this.to = requestConfig.to.replace("_"," ");
        if(requestConfig.dynamicDisplay)
            this.dynamicDisplay = true;
        return this.rcsbFvQuery.requestAlignment({
           queryId: requestConfig.queryId,
           from: requestConfig.from,
           to: requestConfig.to
        } as QueryAlignmentArgs).then(result => {
            this.sequenceLength = result.query_sequence.length;
            const data: AlignmentResponse = result;
            const querySequence: string = data.query_sequence;
            const alignmentData: Array<TargetAlignment> = data.target_alignment;
            const track: RcsbFvRowConfigInterface = {
                trackId: "mainSequenceTrack_" + requestConfig.queryId,
                displayType: RcsbFvDisplayTypes.SEQUENCE,
                trackColor: "#F9F9F9",
                displayColor: "#000000",
                rowTitle: typeof requestConfig.sequenceTrackTitle === "string" ?
                    requestConfig.sequenceTrackTitle : requestConfig.from.replace("_"," ")+" "+TagDelimiter.sequenceTitle+requestConfig.queryId,
                trackData: [{begin: 1, value: result.query_sequence}]
            };
            if(requestConfig.from === SequenceReference.PdbEntity || requestConfig.from === SequenceReference.PdbInstance ){
                track.titleFlagColor = RcsbAnnotationConstants.provenanceColorCode.rcsbPdb;
            }else{
                track.titleFlagColor = RcsbAnnotationConstants.provenanceColorCode.external;
            }
            this.seqeunceConfigData.push(track);
            return this.buildAlignments({
                targetAlignmentList: alignmentData,
                querySequence: querySequence,
                filterByTargetContains:requestConfig.filterByTargetContains,
                to:requestConfig.to,
                from:requestConfig.from
            });
         }).catch(error=>{
             console.log(error);
             throw error;
         });
    }

    public getLength(): number{
        return this.sequenceLength;
    }

    private buildAlignments(alignmentData: BuildAlignementsInterface): SequenceCollectorDataInterface {
        const findMismatch = (seqA: string, seqB: string) => {
            const out = [];
            if (seqA.length === seqB.length) {
                for (let i = 0; i < seqA.length; i++) {
                    if (seqA.charAt(i) !== seqB.charAt(i)) {
                        out.push(i);
                    }
                }
            }
            return out;
        };
        alignmentData.targetAlignmentList.forEach(targetAlignment => {
            if(alignmentData.filterByTargetContains != null && !targetAlignment.target_id.includes(alignmentData.filterByTargetContains))
                return;
            if(targetAlignment.target_sequence == null)
                return;
            this.targets.push(targetAlignment.target_id);
            const targetSequence = targetAlignment.target_sequence;
            const sequenceData: Array<RcsbFvTrackDataElementInterface> = [];
            const alignedBlocks: Array<RcsbFvTrackDataElementInterface> = [];
            const mismatchData: Array<RcsbFvTrackDataElementInterface> = [];
            let next: number = 0;
            let skipRegion: boolean = false;
            targetAlignment.aligned_regions.forEach(region => {
                next++;
                if(skipRegion){
                    skipRegion = false;
                    return;
                }
                const regionSequence = targetSequence.substring(region.target_begin - 1, region.target_end);
                if(targetAlignment.aligned_regions[next]!=null){
                    const nextRegion: AlignedRegion = targetAlignment.aligned_regions[next];
                    if(nextRegion.target_begin === region.target_end+1){
                        sequenceData.push(AnnotationCollector.addAuthorIds({
                            begin: region.query_begin,
                            oriBegin: region.target_begin,
                            sourceId:targetAlignment.target_id,
                            provenance:alignmentData.to,
                            value: regionSequence
                        },alignmentData.to,alignmentData.from));
                        const nextRegionSequence = targetSequence.substring(nextRegion.target_begin - 1, nextRegion.target_end);
                        sequenceData.push(AnnotationCollector.addAuthorIds({
                            begin: nextRegion.query_begin,
                            oriBegin: nextRegion.target_begin,
                            sourceId:targetAlignment.target_id,
                            provenance:alignmentData.to,
                            value: nextRegionSequence
                        },alignmentData.to,alignmentData.from));
                        let openBegin = false;
                        if(region.target_begin != 1)
                            openBegin = true;
                        let openEnd = false;
                        if(nextRegion.target_end!=targetSequence.length)
                            openEnd = true;
                        alignedBlocks.push(AnnotationCollector.addAuthorIds({
                            begin: region.query_begin,
                            end: nextRegion.query_end,
                            oriBegin: region.target_begin,
                            oriEnd: nextRegion.target_end,
                            sourceId:targetAlignment.target_id,
                            provenance:alignmentData.to,
                            openBegin:openBegin,
                            openEnd:openEnd,
                            gaps:[{begin:region.query_end, end:nextRegion.query_begin}],
                            type: "ALIGNED_BLOCK",
                            title: "ALIGNED REGION"
                        },alignmentData.to,alignmentData.from));
                        findMismatch(regionSequence, alignmentData.querySequence.substring(region.query_begin - 1, region.query_end),).forEach(m => {
                            mismatchData.push(AnnotationCollector.addAuthorIds({
                                begin: (m + region.query_begin),
                                oriBegin: (m + region.target_begin),
                                sourceId:targetAlignment.target_id,
                                provenance:alignmentData.to,
                                type: "MISMATCH",
                                label: "MISMATCH"
                            },alignmentData.to,alignmentData.from));
                        });
                        findMismatch(nextRegionSequence, alignmentData.querySequence.substring(nextRegion.query_begin - 1, nextRegion.query_end),).forEach(m => {
                            mismatchData.push(AnnotationCollector.addAuthorIds({
                                begin: (m + nextRegion.query_begin),
                                oriBegin: (m + nextRegion.target_begin),
                                sourceId:targetAlignment.target_id,
                                provenance:alignmentData.to,
                                type: "MISMATCH",
                                label: "MISMATCH"
                            },alignmentData.to,alignmentData.from));
                        });
                        skipRegion = true;
                        return;
                    }
                }
                sequenceData.push(AnnotationCollector.addAuthorIds({
                    begin: region.query_begin,
                    oriBegin: region.target_begin,
                    sourceId:targetAlignment.target_id,
                    provenance:alignmentData.to,
                    value: regionSequence
                },alignmentData.to,alignmentData.from));
                let openBegin = false;
                if(region.target_begin != 1)
                    openBegin = true;
                let openEnd = false;
                if(region.target_end!=targetSequence.length)
                    openEnd = true;
                alignedBlocks.push(AnnotationCollector.addAuthorIds({
                    begin: region.query_begin,
                    end: region.query_end,
                    oriBegin: region.target_begin,
                    oriEnd: region.target_end,
                    sourceId:targetAlignment.target_id,
                    provenance:alignmentData.to,
                    openBegin:openBegin,
                    openEnd:openEnd,
                    type: "ALIGNED_BLOCK",
                    title: "ALIGNED REGION"
                },alignmentData.to,alignmentData.from));
                findMismatch(regionSequence, alignmentData.querySequence.substring(region.query_begin - 1, region.query_end),).forEach(m => {
                    mismatchData.push(AnnotationCollector.addAuthorIds({
                        begin: (m + region.query_begin),
                        oriBegin: (m+region.target_begin),
                        sourceId:targetAlignment.target_id,
                        provenance:alignmentData.to,
                        type: "MISMATCH",
                        title: "MISMATCH"
                    },alignmentData.to,alignmentData.from));
                });
            });
            const sequenceDisplay: RcsbFvDisplayConfigInterface = {
                displayType: RcsbFvDisplayTypes.SEQUENCE,
                displayColor: "#000000",
                displayData: sequenceData,
                dynamicDisplay: this.dynamicDisplay
            };
            const mismatchDisplay: RcsbFvDisplayConfigInterface = {
                displayType: RcsbFvDisplayTypes.PIN,
                displayColor: "#FF9999",
                displayData: mismatchData
            };
            const alignmentDisplay: RcsbFvDisplayConfigInterface = {
                displayType: RcsbFvDisplayTypes.BLOCK,
                displayColor: "#9999FF",
                displayData: alignedBlocks
            };
            const track: RcsbFvRowConfigInterface = {
                trackId: "targetSequenceTrack_",
                displayType: RcsbFvDisplayTypes.COMPOSITE,
                trackColor: "#F9F9F9",
                rowTitle: this.to+" "+TagDelimiter.alignmentTitle+targetAlignment.target_id,
                titleFlagColor:RcsbAnnotationConstants.provenanceColorCode.rcsbPdb,
                displayConfig: [alignmentDisplay, mismatchDisplay, sequenceDisplay]
            };
            this.alignmentsConfigData.push(track);
        });
        this.finished = true;
        return { sequence: this.seqeunceConfigData, alignment:this.alignmentsConfigData};
    }

    public getTargets():Promise<Array<string>> {

        return new Promise<Array<string>>((resolve,reject)=>{
            const recursive:()=>void = ()=>{
                if(this.finished){
                    resolve(this.targets);
                }else{
                    if(typeof window!== "undefined") {
                        window.setTimeout(() => {
                            recursive();
                        }, 1000);
                    }
                }
            };
            recursive();
        });
    }
}